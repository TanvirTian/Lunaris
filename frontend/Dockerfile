# Frontend — Local Development
# Runs Vite dev server with HMR. Source is volume-mounted from host
# so any file you save in frontend/src/ updates the browser instantly.
FROM node:20-slim

WORKDIR /app

# Install dependencies
# Cached layer — only re-runs when package.json changes
COPY package.json package-lock.json ./
RUN npm ci

# Copy source — immediately overridden by the volume mount in docker-compose.yml
COPY . .

EXPOSE 3000

# --host 0.0.0.0 is required — without it Vite only listens on 127.0.0.1
# inside the container, and Docker's port mapping can't reach it
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
