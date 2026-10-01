FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY server.mjs ./
COPY public ./public

USER node
EXPOSE 3002

CMD ["node", "server.mjs"]
