// Serveur proxy minimal pour cacher la clé API Gemini.
// La clé reste ici, sur le serveur (variable d'environnement GEMINI_API_KEY sur Render),
// jamais envoyée au téléphone ni visible dans le code des apps.

const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors()); // ouvert à tous les domaines pour simplifier ; à restreindre si besoin (voir README)
app.use(express.json({ limit: '2mb' }));

const GEMINI_KEY = process.env.GEMINI_API_KEY;
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Proxy Gemini démarré sur le port ${PORT}`);
});
