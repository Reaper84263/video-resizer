FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend ./backend
COPY package.json ./package.json

EXPOSE 3001

CMD ["node", "backend/server.js"]
