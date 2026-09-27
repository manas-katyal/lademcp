FROM node:24-alpine
LABEL org.opencontainers.image.title="LadeMCP" \
      org.opencontainers.image.description="Smart charging for Danish home chargers over OCPP 1.6J, planned on day-ahead prices and CO2." \
      org.opencontainers.image.source="https://github.com/manas-katyal/lademcp" \
      org.opencontainers.image.licenses="MIT" \
      io.modelcontextprotocol.server.name="io.github.manas-katyal/lademcp"
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=8080
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY public ./public
RUN mkdir -p /data && chown -R node:node /data
USER node
EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "src/server.ts"]
