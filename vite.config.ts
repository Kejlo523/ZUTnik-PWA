import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const rawBase = (process.env.VITE_APP_BASE || '/v2/').trim();
const base = `/${rawBase.replace(/^\/+|\/+$/g, '')}`.replace(/\/$/, '') + '/';
const withBase = (path: string) => `${base}${path.replace(/^\/+/, '')}`;
const apiTarget = process.env.VITE_API_PROXY_TARGET || 'http://localhost:8787';

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icons/zutnik-logo.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'sw-cleanup.js'],
      manifest: {
        id: withBase('?source=pwa'), name: 'ZUTnik', short_name: 'ZUTnik',
        description: 'Plan zajęć, oceny i informacje o studiach.',
        start_url: withBase('?source=pwa'), scope: base,
        display: 'standalone', display_override: ['standalone', 'minimal-ui'], orientation: 'any',
        background_color: '#101317', theme_color: '#101317', lang: 'pl',
        icons: [
          { src: withBase('icons/icon-192.png'), sizes: '192x192', type: 'image/png' },
          { src: withBase('icons/icon-512.png'), sizes: '512x512', type: 'image/png' },
          { src: withBase('icons/icon-maskable-512.png'), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        categories: ['education', 'utilities'],
        shortcuts: [
          { name: 'Plan zajęć', short_name: 'Plan', url: withBase('?screen=plan'), icons: [{ src: withBase('icons/icon-192.png'), sizes: '192x192' }] },
          { name: 'Oceny', url: withBase('?screen=grades'), icons: [{ src: withBase('icons/icon-192.png'), sizes: '192x192' }] },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        importScripts: [withBase('sw-cleanup.js')],
        navigateFallback: withBase('index.html'),
        navigateFallbackDenylist: [/\/api\//, /\/stats\/?$/],
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          { urlPattern: /\/api\//, handler: 'NetworkOnly', method: 'GET' },
          { urlPattern: /\/api\//, handler: 'NetworkOnly', method: 'POST' },
          {
            urlPattern: ({ request, sameOrigin, url }) => sameOrigin && request.destination === 'image' && !url.pathname.includes('/api/'),
            handler: 'CacheFirst',
            options: { cacheName: 'zutnik-public-images', expiration: { maxAgeSeconds: 30 * 86400, maxEntries: 60 }, cacheableResponse: { statuses: [200] } },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    host: '0.0.0.0', port: Number(process.env.VITE_PORT || 5173), strictPort: true,
    watch: { ignored: /[\\/](?:test-results[^\\/]*|playwright-report|tests)[\\/]/ },
    proxy: { '/api': { target: apiTarget, changeOrigin: true }, [withBase('stats').replace(/\/$/, '')]: { target: apiTarget, changeOrigin: true } },
  },
});
