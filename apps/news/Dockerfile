FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 LEONA_NEWS_MODE=published
COPY --chown=node:node package.json server.mjs render.mjs live.mjs live-server.mjs ./
COPY --chown=node:node content ./content
COPY --chown=node:node public ./public
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
