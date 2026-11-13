import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
export default defineConfig({ plugins: [vue()], base: './', server: { proxy: { '/api': { target: 'http://127.0.0.1:18182', ws: true } } }, build: { outDir: 'dist', chunkSizeWarningLimit: 900, rollupOptions: { output: { manualChunks: id => id.includes('node_modules') ? (id.includes('element-plus') || id.includes('@element-plus') ? 'element-plus' : 'vendor') : undefined } } } });
