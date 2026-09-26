# Backend — Proxy Gemini

Ce petit serveur sert d'intermédiaire entre les apps (Appel vocal / Fichiers)
et l'API Gemini. Il garde la clé API secrète côté serveur : les apps ne la
connaissent jamais.

## Déploiement sur Render (gratuit)

1. Crée un compte sur [render.com](https://render.com) (gratuit).
2. Mets ce dossier `backend/` dans un dépôt GitHub (voir le README principal
   du projet pour la structure complète).
3. Sur Render : **New +** → **Web Service**.
4. Connecte ton dépôt GitHub, sélectionne-le.
5. Renseigne :
   - **Root Directory** : `backend` (si le backend est dans un sous-dossier
     d'un repo qui contient aussi les apps)
   - **Runtime** : Node
   - **Build Command** : `npm install`
   - **Start Command** : `npm start`
   - **Instance Type** : Free
6. Dans **Environment Variables**, ajoute :
   - `GEMINI_API_KEY` = ta clé API Gemini (celle d'aistudio.google.com)
7. Clique **Create Web Service**. Render te donne une URL du type :
   `https://jarvis-backend-xxxx.onrender.com`

Garde cette URL : c'est elle que tu colleras dans les apps (au lieu d'une
clé API).

## Important — le plan gratuit Render s'endort

Sur le plan gratuit, le serveur se met en veille après 15 minutes sans
utilisation, et met 30-50 secondes à se réveiller au premier appel suivant.
C'est normal, pas un bug. Si ça te gêne, un plan payant Render (~7$/mois)
supprime la veille.

## Tester que ça marche

Une fois déployé, ouvre l'URL Render dans un navigateur : tu dois voir
"Proxy Gemini en ligne." Si tu vois une erreur, vérifie la variable
`GEMINI_API_KEY` dans les réglages Render (onglet Environment).
