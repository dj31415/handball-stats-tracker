<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { api, groupEventsByGame } from '$lib/api';
	import { session, isAdmin, pageTitle } from '$lib/session.svelte';
	import { computePlayerStats, isGoaliePosition, type GameListItem, type Player, type GameEvent } from '@shared/types';
	import { t } from '$lib/i18n/index.svelte';
	import { formatDate } from '$lib/format';

	let activeGame = $state<GameListItem | undefined>();
	let recentGames = $state<(GameListItem & { own: number; opp: number })[]>([]);
	let players = $state<Player[]>([]);
	let allEventsMap = $state<Map<string, GameEvent[]>>(new Map());
	let loadError = $state(false);

	const record = $derived.by(() => {
		let wins = 0, draws = 0, losses = 0;
		for (const g of recentGames) {
			if (g.own > g.opp) wins++;
			else if (g.own === g.opp) draws++;
			else losses++;
		}
		return { wins, draws, losses, total: wins + draws + losses };
	});

	const topScorer = $derived.by(() => {
		if (players.length === 0 || allEventsMap.size === 0) return null;
		let best: { player: Player; goals: number } | null = null;
		for (const p of players.filter(pl => !isGoaliePosition(pl.position))) {
			let goals = 0;
			for (const [, events] of allEventsMap) {
				const s = computePlayerStats(events, p.id);
				goals += s.goals + s.goals_7m;
			}
			if (!best || goals > best.goals) best = { player: p, goals };
		}
		return best && best.goals > 0 ? best : null;
	});

	async function load() {
		loadError = false;
		try {
			const [games, allPlayers, finishedEvents] = await Promise.all([
				api.games.list(),
				api.players.list(),
				api.events.list({ status: 'finished' })
			]);
			activeGame = games.find((g) => g.status !== 'finished');
			recentGames = games
				.filter((g) => g.status === 'finished')
				.slice(0, 5)
				.map((g) => ({ ...g, own: g.own_score, opp: g.opp_score }));
			players = allPlayers;
			const byGame = groupEventsByGame(finishedEvents);
			allEventsMap = new Map(recentGames.map((g) => [g.id, byGame.get(g.id) ?? []]));
		} catch {
			loadError = true;
		}
	}

	onMount(load);
</script>

<svelte:head><title>{pageTitle()}</title></svelte:head>

<div class="flex flex-col gap-6">
	<div class="text-center py-8">
		<h1 class="text-4xl font-bold mb-2">{session.clubName}</h1>
		<p class="text-base-content/60">{t('home.subtitle')}</p>
	</div>

	{#if loadError}
		<div class="alert alert-error">
			<span>{t('common.loadError')}</span>
			<button class="btn btn-sm" onclick={load}>{t('common.retry')}</button>
		</div>
	{/if}

	{#if activeGame}
		<div class="card bg-primary text-primary-content shadow-xl">
			<div class="card-body">
				<h2 class="card-title">{t('home.gameInProgress')}</h2>
				<p>vs {activeGame.opponent} &middot; {t(`gameStatus.${activeGame.status}` as any)}</p>
				<div class="card-actions justify-end">
					{#if isAdmin()}
						<button class="btn btn-secondary" onclick={() => goto(`/game/${activeGame!.id}`)}>
							{t('home.resume')}
						</button>
					{:else}
						<a href="/history/{activeGame.id}" class="btn btn-secondary">{t('common.view')}</a>
					{/if}
				</div>
			</div>
		</div>
	{/if}

	<div class="flex flex-col sm:flex-row gap-4">
		{#if isAdmin()}
			<a href="/game/setup" class="btn btn-primary btn-lg flex-1">{t('home.newGame')}</a>
		{/if}
		<a href="/roster" class="btn btn-outline btn-lg flex-1">{isAdmin() ? t('home.manageRoster') : t('nav.roster')}</a>
	</div>

	{#if recentGames.length > 0}
		<div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
			<!-- Record -->
			<div class="bg-base-200 rounded-box p-4">
				<div class="text-xs text-base-content/60">{t('home.seasonRecord')}</div>
				<div class="text-lg font-bold">{record.wins}{t('common.win')} {record.draws}{t('common.draw')} {record.losses}{t('common.loss')}</div>
				<div class="text-xs text-base-content/60">{record.total} {t('stats.games')}</div>
			</div>
			<!-- Top scorer -->
			{#if topScorer}
				<div class="bg-base-200 rounded-box p-4">
					<div class="text-xs text-base-content/60">{t('home.topScorer')}</div>
					<div class="text-lg font-bold">#{topScorer.player.number}</div>
					<div class="text-xs text-base-content/60">{topScorer.player.name} ({topScorer.goals} {t('home.goalsShort')})</div>
				</div>
			{/if}
			<!-- Last game -->
			{#if recentGames[0]}
				{@const last = recentGames[0]}
				<div class="bg-base-200 rounded-box p-4">
					<div class="text-xs text-base-content/60">{t('home.lastGame')}</div>
					<div class="text-lg font-bold">{last.own} : {last.opp}</div>
					<div class="text-xs text-base-content/60">vs {last.opponent} ({formatDate(last.date)})</div>
				</div>
			{/if}
		</div>

		<div>
			<h2 class="text-xl font-bold mb-3">{t('home.recentGames')}</h2>
			<div class="flex flex-col gap-2">
				{#each recentGames as game}
					{@const result = game.own > game.opp ? t('common.win') : game.own < game.opp ? t('common.loss') : t('common.draw')}
					<a href="/history/{game.id}" class="card bg-base-200 hover:bg-base-300 transition-colors">
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
									<span class="text-base-content/60 ml-2">
										{game.is_home ? t('home.home') : t('home.away')}
									</span>
								</div>
							</div>
							<div class="flex items-center gap-4">
								<span class="font-bold text-lg tabular-nums">{game.own} : {game.opp}</span>
								<span class="text-base-content/60 text-sm">{formatDate(game.date)}</span>
							</div>
						</div>
					</a>
				{/each}
			</div>
			<a href="/history" class="btn btn-ghost btn-sm mt-2">{t('home.viewAll')}</a>
		</div>
	{/if}
</div>
