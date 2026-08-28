import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        // Overridable so a second dev stack (tests, parallel work) can point
        // at its own API instance without fighting the default ports.
        target: process.env.VITE_API_PROXY || 'http://localhost:3001',
        changeOrigin: true,
      }
    }
  }
});