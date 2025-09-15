FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --production
COPY . .
# App listens on PORT (default 3900)
ENV PORT=3900
EXPOSE 3900
CMD ["node","server.js"]