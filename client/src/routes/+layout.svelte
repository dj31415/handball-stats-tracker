<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import { session, isAdmin } from '$lib/session.svelte';
	import { outbox } from '$lib/outbox.svelte';
	import { t } from '$lib/i18n/index.svelte';
	import { trapFocus } from '$lib/focusTrap';
	import { fly } from 'svelte/transition';

	let { children } = $props();
	let drawerOpen = $state(false);

	function isActive(href: string): boolean {
		if (href === '/') return page.url.pathname === '/';
		return page.url.pathname.startsWith(href);
	}

	const isGameView = $derived(
		page.url.pathname.startsWith('/game/') &&
		!page.url.pathname.endsWith('/setup') &&
		!page.url.pathname.endsWith('/summary')
	);

	// Close drawer on navigation
	$effect(() => {
		page.url.pathname;
		drawerOpen = false;
	});

	// Lock body scroll when drawer is open
	$effect(() => {
		document.body.style.overflow = drawerOpen ? 'hidden' : '';
		return () => { document.body.style.overflow = ''; };
	});

	// Restore unsent live-tracking operations from a previous page load.
	outbox.start();

	const onLogin = $derived(page.url.pathname.startsWith('/login'));

	const navLinks: { href: string; key: 'nav.roster' | 'nav.games' | 'nav.stats' | 'nav.settings' }[] = [
		{ href: '/roster', key: 'nav.roster' },
		{ href: '/history', key: 'nav.games' },
		{ href: '/stats', key: 'nav.stats' },
		{ href: '/settings', key: 'nav.settings' },
	];
</script>

{#if isGameView}
	{@render children()}
{:else}
	<div class="min-h-screen bg-base-100">
		<a href="#main" class="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:p-2 focus:bg-primary focus:text-primary-content">{t('nav.skipToContent')}</a>
		<div class="navbar bg-base-200 shadow-lg">
			<!-- Mobile hamburger (left side) -->
			<div class="flex-none sm:hidden" class:hidden={onLogin}>
				<button class="btn btn-ghost btn-square" onclick={() => (drawerOpen = true)} aria-label={t('nav.menu')}>
					<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
					</svg>
				</button>
			</div>
			<div class="flex-1">
				<a href="/" class="btn btn-ghost text-xl font-bold">{session.clubName}</a>
			</div>
			{#if session.role === 'viewer'}
				<span class="badge badge-ghost mr-2 hidden sm:inline-flex">{t('common.readOnly')}</span>
			{/if}
			{#if outbox.ops.length > 0 && isAdmin()}
				<a href={outbox.ops[0] ? `/game/${outbox.ops[0].gameId}` : '/'} class="badge badge-warning mr-2">{t('save.pending', { count: outbox.pending })}</a>
			{/if}
			<!-- Desktop nav -->
			{#if !onLogin}
				<div class="flex-none gap-2 hidden sm:flex">
					{#each navLinks as link}
						<a href={link.href} class="btn btn-ghost btn-sm" class:btn-active={isActive(link.href)}>{t(link.key)}</a>
					{/each}
				</div>
			{/if}
		</div>
		<main id="main" class="container mx-auto p-4 max-w-5xl">
			{@render children()}
		</main>
	</div>

	<!-- Mobile drawer -->
	{#if drawerOpen && !onLogin}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="fixed inset-0 bg-black/60 z-50"
			role="dialog"
			aria-modal="true"
			aria-label={t('nav.menu')}
			tabindex="-1"
			onclick={(e) => { if (e.target === e.currentTarget) drawerOpen = false; }}
			onkeydown={(e) => { if (e.key === 'Escape') drawerOpen = false; }}
			use:trapFocus
		>
			<nav class="h-full w-64 bg-base-200 shadow-2xl flex flex-col" transition:fly={{ x: -256, duration: 200 }}>
				<div class="flex justify-between items-center p-4 border-b border-base-300">
					<span class="text-lg font-bold">{session.clubName}</span>
					<button class="btn btn-ghost btn-sm btn-square" onclick={() => (drawerOpen = false)} aria-label={t('nav.closeMenu')}>
						<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				</div>
				<div class="flex flex-col p-2 gap-1">
					<a href="/" class="btn btn-ghost justify-start" class:btn-active={isActive('/')}>{t('nav.home')}</a>
					{#each navLinks as link}
						<a href={link.href} class="btn btn-ghost justify-start" class:btn-active={isActive(link.href)}>{t(link.key)}</a>
					{/each}
				</div>
			</nav>
		</div>
	{/if}
{/if}
