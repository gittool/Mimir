import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const mimirServerUrl = process.env.MIMIR_SERVER_URL || 'http://localhost:9042';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: mimirServerUrl,
        changeOrigin: true,
      },
      '/v1': {
        target: mimirServerUrl,
        changeOrigin: true,
      },
    },
  },
});
