import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The browser talks only to localhost:5173. Vite forwards /api and /admin to the backend,
// so the session cookie is a plain same-site cookie and no CORS setup is needed in development.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
      '/admin': 'http://localhost:4000',
    },
  },
});
