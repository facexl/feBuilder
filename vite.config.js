import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';


export default defineConfig({
  plugins: [vue()],
  server: {
    host: '0.0.0.0',
    port: 9898,
    watch: {
      // 忽略特定文件的监听
      ignored: ['data/**','**/data/**','.build/**','**/.build/**']
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
