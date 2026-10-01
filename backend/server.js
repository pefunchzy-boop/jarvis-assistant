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
const MODEL = 'gemini-3.5-flash-lite';

app.get('/', (req, res) => {
  res.send('Proxy Gemini en ligne.');
});

app.post('/api/gemini', async (req, res) => {
  if (!GEMINI_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY non configurée sur le serveur.' });
  }

  try {
    const { contents, systemInstruction, generationConfig } = req.body;

    const geminiResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents, systemInstruction, generationConfig }),
      }
    );

    const data = await geminiResp.json();

    if (!geminiResp.ok) {
      return res.status(geminiResp.status).json({ error: data });
    }

    res.json(data);
  } catch (err) {
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

app.get('/api/search', async (req, res) => {
  const query = (req.query.q || '').toString().trim();
  if (!query) {
    return res.status(400).json({ error: 'Paramètre q manquant.' });
  }

  const errors = [];

  // Niveau 1 : grounding Gemini (si la clé existe et le quota n'est pas épuisé)
  if (GEMINI_KEY) {
    for (const attempt of SEARCH_ATTEMPTS) {
      try {
        const results = await geminiSearchOnce(attempt.model, attempt.toolKey, query);
        return res.json({ query, results, via: 'gemini-grounding' });
      } catch (err) {
        errors.push(String(err && err.message ? err.message : err));
      }
    }
    // Le grounding a échoué (quota, modèle...) : on continue vers les fallbacks.
  }

  // Niveau 2 : Google News RSS (actu récente, gratuit, sans quota)
  try {
    const results = await googleNewsSearch(query);
    return res.json({ query, results, via: 'google-news' });
  } catch (err) {
    errors.push(String(err && err.message ? err.message : err));
  }

  // Niveau 3 : DuckDuckGo (faits généraux)
  try {
    const results = await duckduckgoSearch(query);
    return res.json({ query, results, via: 'duckduckgo' });
  } catch (err) {
    errors.push(String(err && err.message ? err.message : err));
  }

  // Niveau 4 : Wikipedia
  try {
    const results = await wikipediaSearch(query);
    return res.json({ query, results, via: 'wikipedia' });
  } catch (err) {
    errors.push(String(err && err.message ? err.message : err));
  }

  res.status(502).json({ error: 'Recherche impossible par tous les moyens. Détails : ' + errors.join(' | ').slice(0, 500) });
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
