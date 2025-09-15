<p align="center">
  <a href="https://nodejs.org/en/">
    <img src="https://img.shields.io/badge/Node.js-20%2B-green?logo=node.js&logoColor=white" alt="Node.js 20+" />
  </a>
  <a href="https://www.npmjs.com/">
    <img src="https://img.shields.io/badge/npm-v10-red?logo=npm&logoColor=white" alt="npm v10" />
  </a>
  <a href="https://www.docker.com/">
    <img src="https://img.shields.io/badge/Docker-24+-blue?logo=docker&logoColor=white" alt="Docker" />
  </a>
  <a href="https://socket.io/">
    <img src="https://img.shields.io/badge/Socket.IO-v4-black?logo=socket.io&logoColor=white" alt="Socket.IO" />
  </a>
</p>

# QuickShare Chat [FR]

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

___

# QuickShare Chat [EN]

Ephemeral self-hosted sessions tool for quick collaboration: mini whiteboard, drawing space, file upload/share (5 GB quota), chat and real-time text via Socket.IO. No personal data required.

Works on Node.js 18+ (recommended: 20).

## Local Installation

```bash
npm install
npm run start
```

By default, the app listens on port 3900. Open: [http://localhost:3900](http://localhost:3900)

## Environment Variables

* PORT: HTTP port (default: 3900)
* DATA\_DIR: storage directory for sessions (default: ./data)
* SESSION\_TTL\_DAYS: session lifespan in days (default: 7)
* SESSION\_QUOTA\_BYTES: quota per session in bytes (default: 5 GB)
* MAX\_UPLOAD\_BYTES: max size per uploaded file (default: 500 MB)
* PAYPAL\_URL: upgrade/donation link shown if quota exceeded (default: placeholder)
* BASE\_PATH: sub-path if the app is served behind a reverse proxy (e.g., /quickshare-chat)

A `.env.example` file is provided as a reference.

## Docker

A `Dockerfile` is provided.

Example execution (PowerShell):

```bash
docker build -t quickshare-chat .
docker run --rm -p 3900:3900 -e PORT=3900 -v ${PWD}/data:/app/data quickshare-chat
```

On CMD: `-v %cd%/data:/app/data`.
On Linux/macOS: `-v $(pwd)/data:/app/data`.

## Reverse Proxy (Nginx)

Serve the app under a sub-path (e.g., /quickshare-chat) and point the proxy to `http://127.0.0.1:3900/`.

See `nginx.conf` for a generic example (replace the domain and certificate paths).

## Security and Best Practices

* Do not commit production data: `data/` is already in `.gitignore`.
* Adjust `MAX_UPLOAD_BYTES` and `SESSION_QUOTA_BYTES` according to your needs.
* Put the app behind an HTTPS reverse proxy in production.

## License

MIT — see `LICENSE`.
