# Dockerfile for Music Bingo — used by Fly.io to build a container image.
# Docs: https://fly.io/docs/languages-and-frameworks/node/

FROM node:20-alpine

WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application source
COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
