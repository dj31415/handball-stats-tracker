<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api';
	import { isAdmin, pageTitle } from '$lib/session.svelte';
	import type { GameListItem } from '@shared/types';
	import { t } from '$lib/i18n/index.svelte';
	import { formatDate } from '$lib/format';

	let games = $state<(GameListItem & { own: number; opp: number })[]>([]);
	let loading = $state(true);
	let loadError = $state(false);

	async function load() {
		loadError = false;
		try {
			const list = await api.games.list();
			games = list.map((g) => ({ ...g, own: g.own_score, opp: g.opp_score }));
		} catch {
			loadError = true;
		} finally {
			loading = false;
		}
	}

	onMount(load);
</script>

<svelte:head><title>{pageTitle(t('title.history'))}</title></svelte:head>

<h1 class="text-2xl font-bold mb-6">{t('history.title')}</h1>

{#if loading}
	<div class="text-center py-12"><span class="loading loading-spinner loading-lg"></span></div>
{:else if loadError}
	<div class="alert alert-error">
		<span>{t('common.loadError')}</span>
		<button class="btn btn-sm" onclick={load}>{t('common.retry')}</button>
	</div>
{:else if games.length === 0}
	<div class="text-center text-base-content/60 py-12">
		<p class="text-lg">{t('history.noGames')}</p>
		{#if isAdmin()}
			<a href="/game/setup" class="btn btn-primary mt-4">{t('history.startFirst')}</a>
		{/if}
	</div>
{:else}
	<div class="flex flex-col gap-2">
		{#each games as game}
			{@const result = game.own > game.opp ? t('common.win') : game.own < game.opp ? t('common.loss') : t('common.draw')}
			<a href={game.status === 'finished' || !isAdmin() ? `/history/${game.id}` : `/game/${game.id}`}
				class="card bg-base-200 hover:bg-base-300 transition-colors">
				<div class="card-body p-4 flex-row justify-between items-center">
					<div class="flex items-center gap-3">
						<span
							class="badge"
							class:badge-success={game.own > game.opp}
							class:badge-error={game.own < game.opp}
							class:badge-warning={game.own === game.opp}
						>
							{result}
						</span>
						<div>
							<span class="font-semibold">vs {game.opponent}</span>
							<span class="text-base-content/60 ml-2">{game.is_home ? t('home.home') : t('home.away')}</span>
						</div>
					</div>
					<div class="flex items-center gap-4">
						<span class="font-bold text-lg tabular-nums">{game.own} : {game.opp}</span>
						<span class="text-base-content/60 text-sm">{formatDate(game.date)}</span>
						{#if game.status !== 'finished'}
							<span class="badge badge-warning badge-sm">{t('history.inProgress')}</span>
						{/if}
					</div>
				</div>
			</a>
		{/each}
	</div>
{/if}
