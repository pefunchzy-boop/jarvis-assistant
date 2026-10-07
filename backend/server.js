// Serveur proxy minimal pour cacher la clé API Gemini.
// La clé reste ici, sur le serveur (variable d'environnement GEMINI_API_KEY sur Render),
// jamais envoyée au téléphone ni visible dans le code des apps.

const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors()); // ouvert à tous les domaines pour simplifier ; à restreindre si besoin (voir README)
// 10 Mo : avant on était à 2 Mo, ce qui provoquait une erreur 413 "Payload Too Large"
// dès que l'historique de conversation ou un contenu encodé devenait trop gros.
app.use(express.json({ limit: '10mb' }));

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const JAMENDO_CLIENT_ID = process.env.JAMENDO_CLIENT_ID; // optionnel, pour la recherche de musique libre de droits
const BREVO_API_KEY = process.env.BREVO_API_KEY; // pour l'envoi réel d'e-mails (Brevo, 300/jour gratuit)
const JARVIS_SENDER_EMAIL = process.env.JARVIS_SENDER_EMAIL; // adresse expéditrice validée dans Brevo
const USER_EMAIL = process.env.USER_EMAIL; // adresse du destinataire (toi)
const MODEL = 'gemini-3.5-flash-lite';

app.get('/', (req, res) => {
  res.send('Proxy Gemini en ligne.');
});

// ---- OUTILS (function calling natif Gemini) ----
// Déclaration des outils proposés au modèle à CHAQUE appel /api/gemini.
// Comme ça, quand l'utilisateur demande une actu ou l'envoi d'un mail, Gemini
// appelle officiellement l'outil au lieu d'inventer un pseudo-JSON
// {"action":"search_web",...} que personne n'exécute (le bug du 02/10/2026).
const SEARCH_TOOL = {
  functionDeclarations: [
    {
      name: 'search_web',
      description: "Rechercher sur le web des informations récentes (actualités du jour, faits d'actualité, événements récents). À utiliser dès que la question porte sur du récent ou de l'actu.",
      parameters: {
        type: 'OBJECT',
        properties: {
          query: { type: 'STRING', description: 'Requête de recherche courte, en français, sans code ni new Date().' },
        },
        required: ['query'],
      },
    },
  ],
};

// Envoi RÉEL d'un e-mail (pas un brouillon) via l'API Brevo.
// Le destinataire est fixé côté serveur (USER_EMAIL) pour que le modèle ne
// puisse pas envoyer de mail à n'importe qui.
const EMAIL_TOOL = {
  functionDeclarations: [
    {
      name: 'send_email',
      description: "Envoyer un vrai e-mail à l'utilisateur (il part réellement, ce n'est pas un brouillon). À utiliser dès que l'utilisateur demande de lui envoyer un e-mail / un mail.",
      parameters: {
        type: 'OBJECT',
        properties: {
          subject: { type: 'STRING', description: "Objet court et clair de l'e-mail." },
          body: { type: 'STRING', description: "Corps de l'e-mail en texte clair, rédigé et prêt à lire. Jamais de JSON ni de code." },
        },
        required: ['subject', 'body'],
      },
    },
  ],
};

const TOOLS = [SEARCH_TOOL, EMAIL_TOOL];

// Note ajoutée côté serveur au systemInstruction pour renforcer l'usage des outils
// et interdire l'ancien comportement qui affichait du code brut à l'utilisateur.
const TOOL_NOTE =
  " [RÈGLE SERVEUR] Pour toute information d'actualité ou de recherche web, tu DOIS utiliser l'outil search_web (function calling). Pour tout envoi d'e-mail demandé par l'utilisateur, tu DOIS utiliser l'outil send_email : l'e-mail est envoyé réellement, ne crée jamais un « brouillon » ni un texte à copier, appelle l'outil. N'écris JAMAIS toi-même un texte du genre {\"action\":\"search_web\"...} ou {\"action\":\"send_email\"...} dans ta réponse : ce n'est pas exécuté et l'utilisateur voit du code brut.";

function withToolNote(systemInstruction) {
  const note = TOOL_NOTE;
  if (!systemInstruction) return { parts: [{ text: note.trim() }] };
  if (typeof systemInstruction === 'string') return { parts: [{ text: systemInstruction + note }] };
  if (systemInstruction.parts && systemInstruction.parts.length) {
    return {
      parts: systemInstruction.parts.map(p => (p.text ? { text: p.text.includes('[RÈGLE SERVEUR]') ? p.text : p.text + note } : p)),
    };
  }
  return systemInstruction;
}

// ---- Génération Gemini avec boucle d'outils ----
async function geminiGenerate(contents, systemInstruction, generationConfig, tools) {
  const geminiResp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents, systemInstruction, generationConfig, tools }),
    }
  );
  const data = await geminiResp.json();
  if (!geminiResp.ok) {
    const err = new Error('Gemini HTTP ' + geminiResp.status);
    err.status = geminiResp.status;
    err.data = data;
    throw err;
  }
  return data;
}

function formatSearchResults(results) {
  const lines = results.map(r => {
    const head = r.title ? r.title : '';
    const url = r.url ? ' (' + r.url + ')' : '';
    const snip = r.snippet ? ' — ' + r.snippet : '';
    return '- ' + head + url + snip;
  });
  const txt = lines.join('\n');
  return txt.length > 6000 ? txt.slice(0, 6000) + '\n...' : txt;
}

// ---- ENVOI D'E-MAIL (Brevo) ----
// Envoi réel via l'API HTTPS de Brevo : aucune dépendance npm en plus (fetch natif).
// Le destinataire est TOUJOURS USER_EMAIL, l'outil ne peut écrire à personne d'autre.
async function sendEmail(subject, bodyText) {
  if (!BREVO_API_KEY) throw new Error('BREVO_API_KEY non configurée sur le serveur.');
  if (!USER_EMAIL) throw new Error('USER_EMAIL non configurée sur le serveur.');
  if (!JARVIS_SENDER_EMAIL) throw new Error('JARVIS_SENDER_EMAIL non configurée sur le serveur.');

  const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': BREVO_API_KEY,
    },
    body: JSON.stringify({
      sender: { name: 'Jarvis', email: JARVIS_SENDER_EMAIL },
      to: [{ email: USER_EMAIL }],
      subject: String(subject || 'Message de Jarvis').slice(0, 200),
      textContent: String(bodyText || '').slice(0, 20000),
    }),
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = (data && data.message) ? data.message : JSON.stringify(data).slice(0, 200);
    throw new Error('Brevo -> HTTP ' + resp.status + ' : ' + msg);
  }
  return data;
}

// Route manuelle pour tester l'envoi (ou l'appeler depuis une autre app).
app.post('/api/email', async (req, res) => {
  const { subject, body } = req.body || {};
  try {
    await sendEmail(subject || 'Message de Jarvis', body || '');
    res.json({ sent: true, to: USER_EMAIL });
  } catch (err) {
    res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
});

app.post('/api/gemini', async (req, res) => {
  if (!GEMINI_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY non configurée sur le serveur.' });
  }

  try {
    let { contents, systemInstruction, generationConfig } = req.body;
    contents = Array.isArray(contents) ? contents.slice() : [];
    systemInstruction = withToolNote(systemInstruction);

    const MAX_ROUNDS = 3; // au plus 3 allers-retours d'outils par réponse

    for (let round = 0; round <= MAX_ROUNDS; round++) {
      const data = await geminiGenerate(contents, systemInstruction, generationConfig, TOOLS);

      const cand = data.candidates && data.candidates[0];
      const parts = (cand && cand.content && cand.content.parts) || [];

      // Cas 1 : function calling officiel -> on exécute l'outil côté serveur
      const fcPart = parts.find(
        p => p.functionCall && (p.functionCall.name === 'search_web' || p.functionCall.name === 'search' || p.functionCall.name === 'send_email')
      );
      if (fcPart) {
        const fc = fcPart.functionCall;
        const args = fc.args || {};

        // On ajoute le tour du modèle (functionCall) puis la réponse de l'outil.
        // IMPORTANT : on renvoie la part ORIGINALE du modèle, telle quelle,
        // pour conserver son thoughtSignature (sinon Gemini renvoie 400
        // "Function call is missing a thought_signature in functionCall parts").
        contents = contents.concat({ role: 'model', parts: [fcPart] });

        // Outil send_email : envoi réel puis on informe le modèle du résultat.
        if (fc.name === 'send_email') {
          const subject = (args.subject || 'Message de Jarvis').toString();
          const body = (args.body || '').toString();
          let emailResponse;
          try {
            await sendEmail(subject, body);
            emailResponse = { sent: true, to: USER_EMAIL };
          } catch (err) {
            emailResponse = {
              error: 'Envoi impossible : ' + String(err && err.message ? err.message : err).slice(0, 200) + '. Dis-le clairement à l’utilisateur, sans inventer de code.',
            };
          }
          contents = contents.concat({
            role: 'user',
            parts: [{ functionResponse: { name: fc.name, response: emailResponse } }],
          });
          continue; // Gemini rédige la confirmation finale
        }

        // Outil search_web : recherche comme avant.
        const query = (args.query || args.q || '').toString().trim();
        if (!query) return res.json(data); // rien à chercher, on renvoie tel quel

        let results = [];
        let searchError = null;
        try {
          const r = await performWebSearch(query);
          results = r.results;
        } catch (err) {
          searchError = String(err && err.message ? err.message : err);
        }

        contents = contents.concat({
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: fc.name,
                response: searchError
                  ? { error: 'Recherche impossible : ' + searchError.slice(0, 200) + '. Réponds avec ce que tu sais, sans inventer de code.' }
                  : { results: results.slice(0, 8) },
              },
            },
          ],
        });
        continue; // on redemande à Gemini avec les résultats
      }

      // Cas 2 (filet de sécurité) : le modèle a quand même écrit un pseudo-JSON
      // {"action":"search_web", "query": "..."} dans sa réponse texte.
      const text = parts.map(p => p.text || '').join('');
      if (text.indexOf('"action"') !== -1 && /search_web|search/.test(text)) {
        const m = text.match(/"query"\s*:\s*"([^"]+)"/) || text.match(/"q"\s*:\s*"([^"]+)"/);
        if (m) {
          const query = m[1].trim();
          let resultsText = '';
          try {
            const r = await performWebSearch(query);
            resultsText = formatSearchResults(r.results);
          } catch (err) {
            resultsText = 'Recherche impossible (' + String(err && err.message ? err.message : err).slice(0, 200) + ').';
          }
          contents = contents.concat({ role: 'model', parts: [{ text }] });
          contents = contents.concat({
            role: 'user',
            parts: [
              {
                text:
                  '[RÉSULTATS DE RECHERCHE WEB pour "' + query + '"]\n' + resultsText +
                  '\n\nUtilise ces résultats pour répondre à la question de l\'utilisateur. Respecte le format de réponse JSON attendu par l\'appli. N\'écris plus jamais de {"action":...} : pour chercher, utilise l\'outil search_web.',
              },
            ],
          });
          continue; // Gemini reformule une vraie réponse
        }
      }

      // Réponse finale propre : on la renvoie telle quelle au client (format inchangé).
      return res.json(data);
    }

    // Nombre max de tours atteint : une dernière génération SANS outil pour forcer une réponse finale.
    const data = await geminiGenerate(contents, systemInstruction, generationConfig, undefined);
    return res.json(data);
  } catch (err) {
    if (err && err.status && err.data) {
      return res.status(err.status).json({ error: err.data });
    }
    res.status(500).json({ error: String(err) });
  }
});

// ---- RECHERCHE WEB ----
// 4 niveaux, du plus riche au plus simple :
// 1) Grounding Google Search de Gemini : synthèse rédigée + sources fraîches.
//    MAIS quota gratuit très limité : dès qu'il est épuisé, l'API renvoie 429.
// 2) Flux RSS Google News (français) : gratuit, sans clé, articles RÉCENTS.
//    C'est le meilleur fallback pour les questions d'actualité.
// 3) API officielle DuckDuckGo (Instant Answer JSON) : gratuite, sans clé.
//    Bon pour les faits généraux, mais renvoie souvent RIEN sur l'actualité.
// 4) API Wikipedia française : gratuite, fiable pour les faits généraux,
//    mais jamais à jour sur l'actualité.
// On essaie dans l'ordre, pour que la recherche ne soit JAMAIS totalement en échec.

const SEARCH_ATTEMPTS = [
  { model: 'gemini-3.5-flash',      toolKey: 'google_search' },
  { model: 'gemini-3.5-flash',      toolKey: 'googleSearch'  },
  { model: 'gemini-3.5-flash-lite', toolKey: 'google_search' },
  { model: 'gemini-3.5-flash-lite', toolKey: 'googleSearch'  },
];

async function geminiSearchOnce(model, toolKey, query) {
  const tools = {};
  tools[toolKey] = {};
  const geminiResp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{ text: `Recherche sur le web et résume de façon factuelle et concise (en français, 5 phrases maximum) : ${query}` }],
        }],
        tools: [tools],
      }),
    }
  );

  const data = await geminiResp.json();

  if (!geminiResp.ok) {
    const msg = (data && data.error && data.error.message) ? data.error.message : JSON.stringify(data).slice(0, 200);
    throw new Error(`${model}/${toolKey} -> HTTP ${geminiResp.status} : ${msg}`);
  }

  const candidate = data.candidates && data.candidates[0];
  const summary = candidate && candidate.content && candidate.content.parts
    ? candidate.content.parts.map(p => p.text || '').join('').trim()
    : '';
  if (!summary) {
    throw new Error(`${model}/${toolKey} -> réponse vide`);
  }

  const chunks = (candidate && candidate.groundingMetadata && candidate.groundingMetadata.groundingChunks) || [];
  const results = [];
  results.push({ title: 'Synthèse de la recherche', url: '', snippet: summary });
  chunks.slice(0, 5).forEach(c => {
    if (c.web) {
      results.push({ title: c.web.title || c.web.uri, url: c.web.uri, snippet: '' });
    }
  });

  return results;
}

function decodeXmlEntities(s) {
  return (s || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(d+);/g, (m, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&amp;/g, '&');
}

async function googleNewsSearch(query) {
  // Flux RSS public de Google News (français) : articles récents correspondant à la requête.
  const url = 'https://news.google.com/rss/search?q=' + encodeURIComponent(query) + '&hl=fr&gl=FR&ceid=FR:fr';
  const resp = await fetch(url, { headers: { 'User-Agent': 'jarvis-assistant/1.0' } });
  if (!resp.ok) throw new Error('GoogleNews -> HTTP ' + resp.status);
  const xml = await resp.text();

  // Les items ressemblent à : <item><title>...</title><link>...</link>...<pubDate>...</pubDate>...</item>
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml)) !== null && items.length < 6) {
    const block = m[1];
    const title = (block.match(/<title>([\s\S]*?)<\/title>/) || [])[1];
    const link = (block.match(/<link>([\s\S]*?)<\/link>/) || [])[1];
    const pubDate = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1];
    const source = (block.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1];
    if (title) {
      let t = decodeXmlEntities(title).trim();
      // Google News colle le nom du média à la fin du titre : "Titre - Le Monde"
      const src = source ? decodeXmlEntities(source).trim() : '';
      if (src && t.endsWith(' - ' + src)) t = t.slice(0, -(' - ' + src).length);
      items.push({
        title: t,
        url: (link || '').trim(),
        snippet: (pubDate ? 'Publié le ' + decodeXmlEntities(pubDate) : '') + (src ? ' — source : ' + src : ''),
      });
    }
  }
  if (!items.length) throw new Error('GoogleNews -> aucun article');
  return items;
}

async function duckduckgoSearch(query) {
  const url = 'https://api.duckduckgo.com/?format=json&no_html=1&skip_disambig=1&q=' + encodeURIComponent(query);
  const resp = await fetch(url, { headers: { 'User-Agent': 'jarvis-assistant/1.0' } });
  if (!resp.ok) throw new Error('DuckDuckGo -> HTTP ' + resp.status);
  const data = await resp.json();

  const results = [];
  if (data.AbstractText) {
    results.push({ title: data.Heading || 'DuckDuckGo', url: data.AbstractURL || '', snippet: data.AbstractText });
  }
  (data.RelatedTopics || []).forEach(t => {
    if (t.Text && t.FirstURL && results.length < 6) {
      results.push({ title: t.Text.split(' - ')[0].slice(0, 80), url: t.FirstURL, snippet: t.Text });
    }
  });
  if (!results.length) throw new Error('DuckDuckGo -> aucun résultat');
  return results;
}

async function wikipediaSearch(query) {
  const searchUrl = 'https://fr.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=3&srsearch=' + encodeURIComponent(query);
  const searchResp = await fetch(searchUrl, { headers: { 'User-Agent': 'jarvis-assistant/1.0' } });
  if (!searchResp.ok) throw new Error('Wikipedia -> HTTP ' + searchResp.status);
  const searchData = await searchResp.json();
  const hits = (searchData.query && searchData.query.search) || [];
  if (!hits.length) throw new Error('Wikipedia -> aucun résultat');

  const results = [];
  for (const h of hits.slice(0, 3)) {
    const sumUrl = 'https://fr.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(h.title.replace(/ /g, '_'));
    const sumResp = await fetch(sumUrl, { headers: { 'User-Agent': 'jarvis-assistant/1.0' } });
    if (sumResp.ok) {
      const s = await sumResp.json();
      results.push({
        title: s.title || h.title,
        url: (s.content_urls && s.content_urls.desktop && s.content_urls.desktop.page) || ('https://fr.wikipedia.org/wiki/' + h.title.replace(/ /g, '_')),
        snippet: s.extract || h.snippet || '',
      });
    } else {
      results.push({ title: h.title, url: 'https://fr.wikipedia.org/wiki/' + h.title.replace(/ /g, '_'), snippet: h.snippet || '' });
    }
  }
  if (!results.length) throw new Error('Wikipedia -> aucun résultat exploitable');
  return results;
}

// Cascade partagée : utilisée par /api/search ET par l'outil search_web du function calling.
async function performWebSearch(query) {
  const errors = [];

  // Niveau 1 : grounding Gemini (si la clé existe et le quota n'est pas épuisé)
  if (GEMINI_KEY) {
    for (const attempt of SEARCH_ATTEMPTS) {
      try {
        const results = await geminiSearchOnce(attempt.model, attempt.toolKey, query);
        return { query, results, via: 'gemini-grounding' };
      } catch (err) {
        errors.push(String(err && err.message ? err.message : err));
      }
    }
    // Le grounding a échoué (quota, modèle...) : on continue vers les fallbacks.
  }

  // Niveau 2 : Google News RSS (actu récente, gratuit, sans quota)
  try {
    const results = await googleNewsSearch(query);
    return { query, results, via: 'google-news' };
  } catch (err) {
    errors.push(String(err && err.message ? err.message : err));
  }

  // Niveau 3 : DuckDuckGo (faits généraux)
  try {
    const results = await duckduckgoSearch(query);
    return { query, results, via: 'duckduckgo' };
  } catch (err) {
    errors.push(String(err && err.message ? err.message : err));
  }

  // Niveau 4 : Wikipedia
  try {
    const results = await wikipediaSearch(query);
    return { query, results, via: 'wikipedia' };
  } catch (err) {
    errors.push(String(err && err.message ? err.message : err));
  }

  throw new Error('Recherche impossible par tous les moyens. Détails : ' + errors.join(' | ').slice(0, 500));
}

app.get('/api/search', async (req, res) => {
  const query = (req.query.q || '').toString().trim();
  if (!query) {
    return res.status(400).json({ error: 'Paramètre q manquant.' });
  }

  try {
    const r = await performWebSearch(query);
    return res.json(r);
  } catch (err) {
    return res.status(502).json({ error: String(err && err.message ? err.message : err) });
  }
});

// Recherche de musique libre de droits (Creative Commons) via Jamendo, gratuit.
// Nécessite un client_id Jamendo gratuit (inscription sur devportal.jamendo.com),
// mis dans la variable d'environnement JAMENDO_CLIENT_ID sur Render.
app.get('/api/music', async (req, res) => {
  const query = (req.query.q || '').toString().trim();
  if (!query) {
    return res.status(400).json({ error: 'Paramètre q manquant.' });
  }
  if (!JAMENDO_CLIENT_ID) {
    return res.status(500).json({ error: 'JAMENDO_CLIENT_ID non configurée sur le serveur.' });
  }

  try {
    const url = `https://api.jamendo.com/v3.0/tracks/?client_id=${encodeURIComponent(JAMENDO_CLIENT_ID)}&format=json&limit=6&search=${encodeURIComponent(query)}&include=musicinfo`;
    const jResp = await fetch(url);
    const data = await jResp.json();

    const tracks = (data.results || []).map(t => ({
      name: t.name,
      artist: t.artist_name,
      duration: t.duration,
      audio: t.audio,
      image: t.image,
      jamendo_url: t.shareurl,
    }));

    res.json({ query, tracks });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Proxy Gemini démarré sur le port ${PORT}`);
});
