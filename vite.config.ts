import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

// base 用相对路径，保证 GitHub Pages 子路径 (/how-to-sing/) 下资源可加载
export default defineConfig({
  base: './',
  plugins:
    [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icons/icon-192.png'],
        manifest: {
          name: '声研所 · 演唱声学分析',
          short_name: '声研所',
          description: '在浏览器里完成演唱声学分析与乐句回放，录音不出设备',
          theme_color: '#1e1b4b',
          background_color: '#1e1b4b',
          display: 'standalone',
          start_url: './',
          scope: './',
          lang: 'zh-CN',
          icons: [
            { src: './icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: './icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        },
      }),
    ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
});
