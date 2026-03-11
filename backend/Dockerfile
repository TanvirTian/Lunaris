# Stage 1 — base
FROM node:20-slim AS base

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci



# Stage 2 — runner  (API + Prisma Studio)
FROM node:20-slim AS runner

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=base /app/node_modules ./node_modules
COPY . .

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

EXPOSE 8000

CMD ["node", "server.js"]



# Stage 3 — worker-runtime  (Playwright crawler)
FROM node:20-slim AS worker-runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
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
    libglib2.0-0 \
    libdbus-1-3 \
    libdrm2 \
    libxkbcommon0 \
    ca-certificates \
    openssl \
 && rm -rf /var/lib/apt/lists/*

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

COPY --from=base /app/node_modules ./node_modules
COPY . .

CMD ["node", "worker.js"]
