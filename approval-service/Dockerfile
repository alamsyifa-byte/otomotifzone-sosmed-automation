FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server.mjs ./
COPY collaborators.mjs instagram-collaborators.json ./
USER node
EXPOSE 3001
CMD ["node", "server.mjs"]
