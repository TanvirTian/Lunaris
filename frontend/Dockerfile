# =============================================================================
# Stage 1: build
# Installs deps and runs vite build → outputs static files to /app/dist
# =============================================================================
FROM node:20-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# VITE_API_URL must be set at BUILD TIME — Vite bakes it into the JS bundle.
# It cannot be changed at runtime without rebuilding.
# In docker-compose we pass it as a build arg → env var.
ARG VITE_API_URL
ARG VITE_APP_NAME=Lunaris
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_APP_NAME=$VITE_APP_NAME

RUN npm run build

# =============================================================================
# Stage 2: serve
# Minimal nginx image — serves the static dist/ files.
# Final image has zero Node.js, zero npm, zero source code.
# =============================================================================
FROM nginx:alpine AS runtime

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Our config: serve static files + proxy /api requests to backend
COPY nginx.conf /etc/nginx/conf.d/app.conf

# Copy built static files from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 3000

CMD ["nginx", "-g", "daemon off;"]
