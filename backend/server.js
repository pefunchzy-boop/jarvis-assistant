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

// Recherche web via l'outil officiel "Grounding with Google Search" de Gemini.
// Utilise la même clé GEMINI_API_KEY, pas de scraping (plus fiable que DuckDuckGo
// depuis un serveur cloud, qui bloque souvent ces requêtes).
app.get('/api/search', async (req, res) => {
  const query = (req.query.q || '').toString().trim();
  if (!query) {
    return res.status(400).json({ error: 'Paramètre q manquant.' });
  }
  if (!GEMINI_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY non configurée sur le serveur.' });
  }

  try {
    const geminiResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [{ text: `Recherche sur le web et résume de façon factuelle et concise (en français, 5 phrases maximum) : ${query}` }],
          }],
          tools: [{ google_search: {} }],
        }),
      }
    );

    const data = await geminiResp.json();
    if (!geminiResp.ok) {
      return res.status(geminiResp.status).json({ error: data });
    }

    const candidate = data.candidates && data.candidates[0];
    const summary = candidate && candidate.content && candidate.content.parts
      ? candidate.content.parts.map(p => p.text || '').join('').trim()
      : '';

    // Sources fournies par le grounding
    const chunks = (candidate && candidate.groundingMetadata && candidate.groundingMetadata.groundingChunks) || [];
    const results = [];
    if (summary) {
      results.push({ title: 'Synthèse de la recherche', url: '', snippet: summary });
    }
    chunks.slice(0, 5).forEach(c => {
      if (c.web) {
        results.push({ title: c.web.title || c.web.uri, url: c.web.uri, snippet: '' });
      }
    });

    res.json({ query, results });
  } catch (err) {
    res.status(500).json({ error: String(err) });
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
