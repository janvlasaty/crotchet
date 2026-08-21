import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: process.env.CI ? '/crotchet/' : '/',
  server: {
    // Listen on the LAN so phones on the same Wi-Fi can open the dev server.
    host: true,
    port: 5173,
  },
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? 'dev'),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icons/*.png'],
      workbox: {
        // The song bundle grows past Workbox's 2 MiB default, at which point the
        // main chunk is dropped from the precache manifest with only a warning
        // and the app stops working offline.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api/],
        globIgnores: ['**/version.json'],
        skipWaiting: false,
        clientsClaim: true,
      },
      manifest: {
        name: 'Zpěvník',
        short_name: 'Zpěvník',
        description: 'Akordy a texty pro hraní',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0f0f0f',
        theme_color: '#0f0f0f',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
});
