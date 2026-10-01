FROM mcr.microsoft.com/playwright:v1.63.0-noble
WORKDIR /app
COPY --chown=root:root package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund
COPY --chown=root:root server.mjs ./server.mjs
COPY --chown=root:root asset-map.json ./asset-map.json
COPY --chown=root:root design-assets/ ./design-assets/
ENV NODE_ENV=production
ENV PORT=3000
ENV HOME=/tmp
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
USER pwuser
EXPOSE 3000
CMD ["node", "server.mjs"]
