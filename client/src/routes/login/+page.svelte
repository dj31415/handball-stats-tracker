<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api, ApiError } from '$lib/api';
	import { outbox } from '$lib/outbox.svelte';
	import { session, pageTitle } from '$lib/session.svelte';
	import { t } from '$lib/i18n/index.svelte';

	let password = $state('');
	let error = $state('');
	let submitting = $state(false);

	function safeNext(): string {
		const next = page.url.searchParams.get('next');
		return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/login') ? next : '/';
	}

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (!password || submitting) return;
		submitting = true;
		error = '';
		try {
			await api.auth.login(password);
			password = '';
			outbox.resume();
			await goto(safeNext(), { invalidateAll: true, replaceState: true });
		} catch (err) {
			if (err instanceof ApiError && err.status === 401) {
				error = t('login.invalid');
			} else if (err instanceof ApiError && err.status === 429) {
				error = t('login.rateLimited', { minutes: Math.max(1, Math.ceil((err.body?.retry_after ?? 60) / 60)) });
			} else {
				error = t('login.networkError');
			}
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head><title>{pageTitle(t('title.login'))}</title></svelte:head>

<div class="max-w-sm mx-auto mt-12">
	<div class="text-center mb-6">
		<h1 class="text-3xl font-bold">{session.clubName}</h1>
		<p class="text-base-content/60 mt-1">{t('login.title')}</p>
	</div>
	<form class="card bg-base-200" onsubmit={submit}>
		<div class="card-body">
			<div class="form-control">
				<label class="label" for="password"><span class="label-text">{t('login.password')}</span></label>
				<input
					id="password"
					type="password"
					class="input input-bordered w-full"
					autocomplete="current-password"
					bind:value={password}
				/>
			</div>
			{#if error}
				<p class="text-error text-sm" role="alert">{error}</p>
			{/if}
			<div class="card-actions mt-4">
				<button class="btn btn-primary w-full" type="submit" disabled={!password || submitting}>
					{#if submitting}<span class="loading loading-spinner loading-sm"></span>{/if}
					{t('login.submit')}
				</button>
			</div>
		</div>
	</form>
</div>
