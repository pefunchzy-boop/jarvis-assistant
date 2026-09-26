# Contexte du projet — à coller au début d'une nouvelle conversation

Je développe un assistant vocal type "Jarvis" en 3 parties, tout en HTML/JS
autonome (fichiers uniques, pas de build), pensé pour être installé comme
PWA sur iPhone et Android. Le tout est dans UN SEUL dépôt GitHub avec
sous-dossiers, pour que les apps partagent le même domaine (donc le même
localStorage).

## Structure du projet (un seul dépôt)

```
assistant-vocal/
├── backend/       (proxy Gemini, à déployer sur Render)
├── appel/         (app vocale, index.html)
├── fichiers/      (app fichiers, index.html)
└── README.md
```

1. **appel/** — l'app principale : appel vocal façon WhatsApp, avec une
   boule centrale animée (façon ChatGPT) qui change de couleur/anime selon
   l'état (respire au repos, pulse en écoute, tourne en jaune-doré quand
   elle réfléchit). Deux modes : appui sur bouton (push-to-talk) ou écoute
   continue façon appel, avec bascule entre les deux. Utilise la
   reconnaissance vocale et la synthèse vocale natives du navigateur (Web
   Speech API), 100% gratuites, pas de voix IA payante. Pendant l'appel,
   l'IA peut faire apparaître des cartes flottantes déplaçables à l'écran
   (note, image, post LinkedIn texte+image, météo, minuteur, calcul, liste
   de tâches, fichier). Plusieurs cartes peuvent apparaître en une seule
   réponse. Bouton pour naviguer vers l'app fichiers (`../fichiers/`).
   Réglages : URL du serveur backend, ton de personnalité (amical/formel/
   direct/humour), notifications (pour les minuteurs notamment).

2. **fichiers/** — app séparée, qui liste/édite/supprime/recherche les
   fichiers texte créés par l'assistant. Stockage : localStorage, clé
   `assistant_files_v1`, tableau de {id, name, content, createdAt,
   updatedAt}. Comme les 2 apps sont sous le même domaine (sous-dossiers
   du même dépôt GitHub Pages), elles PARTAGENT ce stockage. Inclut une
   fonctionnalité de dictée vocale pour remplir le contenu d'un fichier
   (bouton micro dans l'éditeur, Web Speech API). Bouton pour naviguer
   vers l'app appel (`../appel/`).

3. **backend/** — petit serveur Node/Express, déployé sur Render (gratuit),
   qui sert de proxy vers l'API Gemini. MODÈLE ACTUEL : `gemini-3.5-flash`
   (gemini-2.0-flash est arrêté depuis juin 2026, ne plus l'utiliser). La
   clé API Gemini ne doit JAMAIS être écrite en clair dans le code des
   apps (risque de fuite si le dépôt GitHub est public) : le backend la
   lit depuis une variable d'environnement GEMINI_API_KEY sur Render et
   expose une route POST /api/gemini. Les apps n'appellent que l'URL du
   serveur Render (stockée dans les réglages de l'app, en localStorage).

## Prompt système de l'IA (dans appel/, fonction buildSystemPrompt())

Varie selon le ton choisi par l'utilisateur (amical/formel/direct/humour).
Répond toujours en JSON strict : {"spoken": "...", "cards": [...]}.
Types de cartes : note, image (Pollinations.ai, gratuit sans clé),
linkedin_post (texte + image, jamais publié automatiquement), weather
(Open-Meteo, gratuit sans clé), timer (décompte + vibration + annonce
vocale + notification si activée), calc, checklist, file (sauvegarde
persistante partagée avec l'app fichiers).

## Design

Thème sombre, accent vert émeraude (#39e0a4), style "HUD vocal".

## Où en est le projet

- Les 3 dossiers sont codés et fonctionnels, avec README d'installation
  GitHub Pages (un seul dépôt) + Render.
- Recherche web : PAS ENCORE FAITE — prochaine étape prévue, mentionnée
  plusieurs fois mais jamais implémentée.
- Notifications : ajoutées, avec limite connue sur iPhone (iOS 16.4+
  requis, app installée à l'écran d'accueil obligatoire).
- Édition vocale des fichiers : ajoutée dans l'app fichiers.
- Tons de personnalité : ajoutés (4 options).
- Synchronisation fichiers entre les 2 apps : fonctionne SI ET SEULEMENT
  SI les 2 apps sont servies depuis le même domaine (d'où la
  restructuration en un seul dépôt avec sous-dossiers).
- Sécurité : la clé API Gemini ne doit jamais apparaître dans le code ou
  la conversation — uniquement en variable d'environnement sur Render.
- Préférence : rester gratuit autant que possible.

## Si tu reprends ce projet

Demande-moi ce que je veux ajouter/modifier avant de coder. Si je fournis
le code existant (les fichiers du zip), pars de cette base plutôt que de
tout recréer de zéro. Ne jamais me redemander ma clé API dans le chat —
je la mets moi-même directement dans Render.
