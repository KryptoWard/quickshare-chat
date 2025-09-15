# QuickShare Chat

Outil de sessions éphémères auto‑hébergeable pour collaborer rapidement : mini tableau, espace de dessin, dépôt/partage de fichiers (quota 5 Go), chat et texte en temps réel via Socket.IO. Aucune donnée personnelle.

Fonctionne sur Node.js 18+ (recommandé : 20).

## Installation locale

```bash
npm install
npm run start
```

Par défaut, l’application écoute sur le port 3900. Ouvrez : http://localhost:3900

## Variables d’environnement

- PORT : port HTTP (défaut : 3900)
- DATA_DIR : répertoire de stockage des sessions (défaut : ./data)
- SESSION_TTL_DAYS : durée de vie d’une session en jours (défaut : 7)
- SESSION_QUOTA_BYTES : quota par session en octets (défaut : 5 Go)
- MAX_UPLOAD_BYTES : taille max par fichier uploadé (défaut : 500 Mo)
- PAYPAL_URL : lien d’upgrade/don affiché si quota dépassé (défaut : placeholder)
- BASE_PATH : sous‑chemin si l’app est servie derrière un reverse proxy (ex : /quickshare-chat)

Un fichier `.env.example` est fourni pour référence.

## Docker

Un `Dockerfile` est fourni.

Exemple d’exécution (PowerShell) :

```bash
docker build -t quickshare-chat .
docker run --rm -p 3900:3900 -e PORT=3900 -v ${PWD}/data:/app/data quickshare-chat
```

Sous CMD : `-v %cd%/data:/app/data`. Sous Linux/macOS : `-v $(pwd)/data:/app/data`.

## Reverse proxy (Nginx)

Servez l’application sous un sous‑chemin (ex : /quickshare-chat) et faites pointer le proxy vers `http://127.0.0.1:3900/`.

Voir `nginx.conf` pour un exemple générique (remplacez le domaine et les chemins de certificats).

## Sécurité et bonnes pratiques

- Ne commitez pas de données de production : `data/` est déjà dans `.gitignore`.
- Ajustez `MAX_UPLOAD_BYTES` et `SESSION_QUOTA_BYTES` selon vos contraintes.
- Placez l’app derrière un reverse proxy HTTPS en production.

## Licence

MIT — voir `LICENCE`.