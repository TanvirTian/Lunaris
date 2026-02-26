FROM node:20-slim AS deps

WORKDIR /app

COPY package.json package-lock.json ./


RUN npm ci --omit=dev


FROM node:20-slim AS runtime


RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libxfixes3 \
    libxi6 \
    libgbm1 \
    libcups2 \
    libasound2 \
    libgtk-3-0 \
    ca-certificates \
 && rm -rf /var/lib/apt/lists/*


ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

ENV PLAYWRIGHT_BROWSERS_PATH=0


RUN mkdir -p /app && chown node:node /app
USER node

WORKDIR /app


COPY --from=deps --chown=node:node /app/node_modules ./node_modules


COPY --chown=node:node . .


RUN npx prisma generate

ENV NODE_ENV=production

EXPOSE 8000

CMD ["node", "server.js"]
