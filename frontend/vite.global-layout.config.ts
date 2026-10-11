import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], cacheDir: '.vite-global-cache', server: { host: '127.0.0.1' } });
