# Lightweight Node image / Image Node légère
FROM node:20-alpine

# Working directory / Répertoire de travail
WORKDIR /app

# Install production deps / Installer dépendances prod
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --production

# Copy project files / Copier les fichiers du projet
COPY . .

# App listens on PORT (default 3900) / L'app écoute sur PORT (défaut 3900)
ENV PORT=3900
EXPOSE 3900

# Start server / Démarrer le serveur
CMD ["node","server.js"]