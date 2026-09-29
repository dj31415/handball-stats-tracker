// Kill switch for the service worker shipped by older versions of this app.
// Browsers that still have the old worker registered fetch this file, install it,
// and it removes itself together with all caches.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			const keys = await caches.keys();
			await Promise.all(keys.map((k) => caches.delete(k)));
			await self.registration.unregister();
			const clients = await self.clients.matchAll({ type: 'window' });
			clients.forEach((c) => c.navigate(c.url));
		})()
	);
});
