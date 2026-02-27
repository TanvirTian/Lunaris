import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    // Must bind to all interfaces — without this Vite only listens on
    // 127.0.0.1 inside the container and Docker can't route to it
    host: '0.0.0.0',
    proxy: {
      // VITE_BACKEND_URL is set by docker-compose.yml to 'http://backend:8000'
      // 'backend' is the Docker service name — Docker DNS resolves it internally.
      // Falls back to localhost:8000 if you ever run Vite directly on your host.
      '/analyze': { target: process.env.VITE_BACKEND_URL || 'http://localhost:8000', changeOrigin: true },
      '/scan':    { target: process.env.VITE_BACKEND_URL || 'http://localhost:8000', changeOrigin: true },
      '/scans':   { target: process.env.VITE_BACKEND_URL || 'http://localhost:8000', changeOrigin: true },
      '/health':  { target: process.env.VITE_BACKEND_URL || 'http://localhost:8000', changeOrigin: true },
      '/metrics': { target: process.env.VITE_BACKEND_URL || 'http://localhost:8000', changeOrigin: true },
    },
  },
});
