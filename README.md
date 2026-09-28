# Assistant vocal — Jarvis

Projet en 3 parties, dans un seul dépôt :

- **`backend/`** — petit serveur qui cache ta clé API Gemini (à déployer sur Render, gratuit)
- **`appel/`** — l'app vocale (la boule qui réagit, le micro, les cartes flottantes)
- **`fichiers/`** — l'app "Mes fichiers" (notes et documents créés, consultables/modifiables)

Chaque app est un seul fichier `index.html` autonome, installable sur l'écran
d'accueil du téléphone (iPhone et Android), sans magasin d'applications.

**Important** : les deux apps partagent leurs fichiers automatiquement
**si et seulement si** elles sont servies depuis le même domaine — c'est
pour ça qu'elles sont dans le même dépôt GitHub Pages, en sous-dossiers
`/appel/` et `/fichiers/`. Un bouton dans chaque app permet de passer de
l'une à l'autre.

---

## Étape 1 — Mettre le projet sur GitHub

1. Va sur [github.com](https://github.com), connecte-toi (ou crée un compte).
2. **+** en haut à droite → **New repository**.
3. Nom : par exemple `assistant-vocal`. Garde-le **Public**.
4. Coche **Add a README** puis **Create repository**.
5. Dans le dépôt créé, clique **Add file** → **Upload files**.
6. Glisse **tout le contenu** de ce dossier (les 3 sous-dossiers + les
   fichiers à la racine) dans la zone d'upload. GitHub garde l'arborescence.
7. **Commit changes**.

Ton dépôt doit ressembler à :
```
assistant-vocal/
├── backend/
│   ├── server.js
│   ├── package.json
│   └── README.md
├── appel/
│   └── index.html
├── fichiers/
│   └── index.html
└── README.md
```

## Étape 2 — Déployer le backend sur Render

Suis le guide détaillé dans `backend/README.md`. En résumé :
1. Compte sur [render.com](https://render.com)
2. New Web Service → connecte ton dépôt GitHub
3. Root Directory : `backend`
4. Ajoute la variable d'environnement `GEMINI_API_KEY` avec ta clé
   (jamais dans le code, uniquement ici, dans Render)
5. Render te donne une URL (`https://....onrender.com`) — garde-la

## Étape 3 — Activer GitHub Pages

1. Dans ton dépôt GitHub → **Settings** → **Pages**.
2. Source : **Deploy from a branch** → branche `main`, dossier `/ (root)` →
   **Save**.
3. Attends 1-2 minutes. Ton site est en ligne à :
   `https://tonpseudo.github.io/assistant-vocal/`
4. L'app Appel est à `https://tonpseudo.github.io/assistant-vocal/appel/`
5. L'app Fichiers est à `https://tonpseudo.github.io/assistant-vocal/fichiers/`

Comme les deux sont sous le même domaine `tonpseudo.github.io`, elles
partagent bien le même stockage de fichiers.

## Étape 4 — Installer les apps sur ton téléphone

1. Ouvre le lien `.../appel/` dans Safari (iPhone) ou Chrome (Android).
2. Dans l'app, ouvre les réglages (icône engrenage) et colle l'URL de ton
   backend Render.
3. **iPhone** : bouton Partager (carré avec flèche) → **Sur l'écran
   d'accueil**.
   **Android** : menu ⋮ → **Ajouter à l'écran d'accueil** (ou bandeau
   d'installation automatique).
4. Fais pareil avec le lien `.../fichiers/`.

Tu as maintenant deux icônes sur ton écran d'accueil, qui s'ouvrent en
plein écran comme de vraies apps, et qui partagent leurs fichiers.

## Notifications

Dans les réglages de l'app Appel, active "Notifications" : le navigateur
te demandera la permission. Utile surtout pour être prévenu quand un
minuteur se termine, même si tu n'es pas en train de regarder l'écran.
Sur iPhone, ça ne fonctionne que si l'app a été ajoutée à l'écran
d'accueil (pas juste ouverte dans Safari) et depuis iOS 16.4 minimum.

## Tons de personnalité

Toujours dans les réglages de l'app Appel : choisis entre amical, formel,
direct, ou avec humour. Ça change la façon dont l'assistant te répond.

## Recherche web

L'assistant peut chercher sur le web (via l'outil intégré de Gemini, « Grounding with Google Search », avec ta clé Gemini existante, quota gratuit quotidien limité)
quand la question porte sur une actualité, un fait récent, ou une info
qu'il ne peut pas connaître de mémoire. Ça passe automatiquement par ton
serveur Render (route `/api/search`), pas besoin de configuration
supplémentaire. Les sources utilisées apparaissent dans une carte dédiée.

## Musique

Deux façons de faire de la musique dans l'app, selon la demande :

- **Composer une partition** ("compose-moi une mélodie", "écris une
  partition") → l'IA génère une vraie petite partition (notation ABC),
  affichée et jouable directement dans l'app (bouton ▶), gratuit, sans
  clé (bibliothèque abcjs).
- **Écouter un morceau existant** ("mets-moi une musique calme",
  "trouve-moi un son d'ambiance") → recherche dans le catalogue Creative
  Commons de Jamendo (musique réelle, libre de droits, écoutable
  directement dans la carte).

Pour activer la recherche Jamendo, il faut un `client_id` gratuit :
1. Inscris-toi sur [devportal.jamendo.com](https://devportal.jamendo.com)
2. Crée une application, récupère le `client_id` (pas besoin du secret)
3. Sur Render, ajoute la variable d'environnement `JAMENDO_CLIENT_ID`
   avec cette valeur

Sans cette variable, la composition de partitions fonctionne quand même
(elle ne dépend pas de Jamendo) — seule la recherche de musique existante
sera indisponible.

## Mettre à jour le code plus tard

Dans GitHub, ouvre le fichier à modifier, clique l'icône crayon, colle le
nouveau contenu, **Commit changes**. Le site se met à jour en 1-2 minutes.
