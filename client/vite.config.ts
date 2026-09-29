import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	server: {
		proxy: {
			// No changeOrigin: the server compares the Origin header with Host,
			// so Host must stay at the dev server's host.
			'/api': 'http://localhost:3001'
		}
	},
	plugins: [tailwindcss(), sveltekit()]
});
