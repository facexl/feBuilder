import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

const noHmr = process.env.NO_HMR === 'true';

export default defineConfig({
  plugins: [vue()],
  server: {
    host: '0.0.0.0',
    port: 9898,
    // hmr: noHmr ? false : undefined,
    // watch: noHmr ? null : undefined,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
