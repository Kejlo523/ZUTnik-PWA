self.addEventListener('activate', (event) => {
  // Older workers cached authenticated GET responses without an account boundary.
  const legacy = new Set(['api-cache', 'pages', 'zut-assets']);
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => legacy.has(key)).map((key) => caches.delete(key)))));
});
