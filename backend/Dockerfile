# Backend — Local Development
# Installs deps and starts the server. Source is volume-mounted from host
# so changes are live without rebuilding. node --watch handles restarts.

FROM node:20-slim

# Chromium dependencies — needed for Playwright
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
    ca-certificates \
    openssl \
 && rm -rf /var/lib/apt/lists/*

# Tell Playwright to use the system Chromium we just installed
# instead of downloading its own copy
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Install dependencies
# This layer is cached — only re-runs when package.json changes,
# not when your source files change
COPY package.json package-lock.json ./
RUN npm ci

EXPOSE 8000

CMD ["node", "server.js"]
