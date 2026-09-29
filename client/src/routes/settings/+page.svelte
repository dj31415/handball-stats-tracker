<script lang="ts">
	import { goto } from '$app/navigation';
	import { api } from '$lib/api';
	import { session, pageTitle } from '$lib/session.svelte';
	import { outbox } from '$lib/outbox.svelte';
	import { t } from '$lib/i18n/index.svelte';
	import { getLocale, setLocale, type Locale } from '$lib/i18n/index.svelte';

	let loggingOut = $state(false);

	function handleLocaleChange(e: Event) {
		setLocale((e.target as HTMLSelectElement).value as Locale);
	}

	async function logout() {
		loggingOut = true;
		try {
			await api.auth.logout();
		} catch {
			/* cookie may be gone already; go to login regardless */
		}
		session.role = null;
		await goto('/login', { invalidateAll: true });
		loggingOut = false;
	}
</script>

<svelte:head><title>{pageTitle(t('title.settings'))}</title></svelte:head>

<h1 class="text-2xl font-bold mb-6">{t('settings.title')}</h1>

<div class="flex flex-col gap-6">
	<!-- Language -->
	<div class="card bg-base-200">
		<div class="card-body">
			<h3 class="card-title">{t('settings.language')}</h3>
			<div class="form-control w-48">
				<select class="select select-bordered" value={getLocale()} onchange={handleLocaleChange}>
					<option value="de">Deutsch</option>
					<option value="en">English</option>
				</select>
			</div>
		</div>
	</div>

	<!-- Account -->
	<div class="card bg-base-200">
		<div class="card-body">
			<h3 class="card-title">{t('settings.account')}</h3>
			<p class="text-base-content/60">
				{t('settings.roleLabel')}:
				<span class="font-semibold">{session.role === 'admin' ? t('settings.roleAdmin') : t('settings.roleViewer')}</span>
			</p>
			{#if outbox.ops.length > 0}
				<p class="text-warning text-sm">{t('save.pending', { count: outbox.pending })}</p>
			{/if}
			<div class="card-actions mt-4">
				<button class="btn btn-ghost" onclick={logout} disabled={loggingOut}>{t('settings.logout')}</button>
			</div>
		</div>
	</div>

	<div class="card bg-base-200">
		<div class="card-body">
			<h3 class="card-title">{t('settings.about')}</h3>
			<p class="text-base-content/60">
				{t('settings.aboutText')}
			</p>
		</div>
	</div>
</div>
