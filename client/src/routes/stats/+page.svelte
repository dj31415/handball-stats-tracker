<script lang="ts">
	import { onMount } from 'svelte';
	import { api, groupEventsByGame } from '$lib/api';
	import { pageTitle } from '$lib/session.svelte';
	import {
		type Player,
		type Game,
		type GameEvent,
		type PlayerGameStats,
		type Season,
		computePlayerStats,
		teamScore,
		opponentScore,
		isGoaliePosition
	} from '@shared/types';
	import { t } from '$lib/i18n/index.svelte';
	import { getChartColors } from '$lib/chart-setup';
	import {
		buildWinDrawLossData,
		buildGoalDifferentialData,
		buildTopScorersData,
		buildEfficiencyTrendData
	} from '$lib/chart-data';
	import ChartWrapper from '$components/ChartWrapper.svelte';

	let players = $state<Player[]>([]);
	let games = $state<Game[]>([]);
	let seasons = $state<Season[]>([]);
	let allEvents = $state<Map<string, GameEvent[]>>(new Map());
	let loading = $state(true);
	let selectedSeasonId = $state<string>('all');

	// Sorting state
	type FieldSortKey = 'number' | 'name' | 'gp' | 'goals' | 'misses' | 'rate' | 'sevenM' | 'tm' | 'twoMin';
	type GoalieSortKey = 'number' | 'name' | 'gp' | 'saves' | 'conceded' | 'saveRate' | 'sevenMSv' | 'sevenMCon' | 'sevenMRate';

	let fieldSort = $state<{ key: FieldSortKey; asc: boolean }>({ key: 'number', asc: true });
	let goalieSort = $state<{ key: GoalieSortKey; asc: boolean }>({ key: 'number', asc: true });

	function toggleFieldSort(key: FieldSortKey) {
		fieldSort = fieldSort.key === key ? { key, asc: !fieldSort.asc } : { key, asc: false };
	}
	function toggleGoalieSort(key: GoalieSortKey) {
		goalieSort = goalieSort.key === key ? { key, asc: !goalieSort.asc } : { key, asc: false };
	}

	const filteredGames = $derived(
		selectedSeasonId === 'all'
			? games.filter(g => g.status === 'finished')
			: games.filter(g => g.status === 'finished' && g.season_id === selectedSeasonId)
	);

	// Aggregated stats per player across filtered finished games
	const aggregatedStats = $derived.by(() => {
		const result = new Map<string, PlayerGameStats & { gamesPlayed: number }>();
		for (const player of players) {
			let agg = {
				player_id: player.id,
				goals: 0, misses: 0, goals_7m: 0, misses_7m: 0,
				tech_mistakes: 0, suspensions_2min: 0, yellow_cards: 0, red_cards: 0,
				saves: 0, saves_7m: 0, conceded: 0, conceded_7m: 0,
				gamesPlayed: 0
			};
			for (const game of filteredGames) {
				const events = allEvents.get(game.id) || [];
				const hasEvents = events.some(e => e.player_id === player.id);
				if (!hasEvents) continue;
				agg.gamesPlayed++;
				const s = computePlayerStats(events, player.id);
				agg.goals += s.goals; agg.misses += s.misses;
				agg.goals_7m += s.goals_7m; agg.misses_7m += s.misses_7m;
				agg.tech_mistakes += s.tech_mistakes; agg.suspensions_2min += s.suspensions_2min;
				agg.yellow_cards += s.yellow_cards; agg.red_cards += s.red_cards;
				agg.saves += s.saves; agg.saves_7m += s.saves_7m;
				agg.conceded += s.conceded; agg.conceded_7m += s.conceded_7m;
			}
			if (agg.gamesPlayed > 0) result.set(player.id, agg);
		}
		return result;
	});

	const finishedGames = $derived(filteredGames);
	const record = $derived.by(() => {
		let wins = 0, draws = 0;
		for (const g of finishedGames) {
			const ev = allEvents.get(g.id) || [];
			const own = teamScore(ev), opp = opponentScore(ev);
			if (own > opp) wins++;
			else if (own === opp) draws++;
		}
		return { wins, draws, losses: finishedGames.length - wins - draws };
	});

	const chartColors = $derived(finishedGames.length > 0 ? getChartColors() : null);

	const wdlChart = $derived.by(() => {
		if (!chartColors) return null;
		return buildWinDrawLossData(record, {
			wins: t('chart.wins'), draws: t('chart.draws'), losses: t('chart.losses')
		}, chartColors);
	});

	const goalDiffChart = $derived.by(() => {
		if (!chartColors) return null;
		return buildGoalDifferentialData(finishedGames, allEvents, chartColors, t('chart.goalDiff'));
	});

	const topScorersChart = $derived.by(() => {
		if (!chartColors || aggregatedStats.size === 0) return null;
		return buildTopScorersData(players, aggregatedStats, chartColors);
	});

	const efficiencyChart = $derived.by(() => {
		if (!chartColors) return null;
		return buildEfficiencyTrendData(finishedGames, allEvents, chartColors, t('chart.successRate'));
	});

	const sortedFieldPlayers = $derived.by(() => {
		const rows = players
			.filter(p => !isGoaliePosition(p.position) && aggregatedStats.has(p.id))
			.map(p => {
				const s = aggregatedStats.get(p.id)!;
				const goals = s.goals + s.goals_7m;
				const misses = s.misses + s.misses_7m;
				const total = goals + misses;
				return { player: p, stats: s, goals, misses, total, rate: total > 0 ? goals / total : 0 };
			});
		const { key, asc } = fieldSort;
		const dir = asc ? 1 : -1;
		rows.sort((a, b) => {
			switch (key) {
				case 'number': return (a.player.number - b.player.number) * dir;
				case 'name': return a.player.name.localeCompare(b.player.name) * dir;
				case 'gp': return (a.stats.gamesPlayed - b.stats.gamesPlayed) * dir;
				case 'goals': return (a.goals - b.goals) * dir;
				case 'misses': return (a.misses - b.misses) * dir;
				case 'rate': return (a.rate - b.rate) * dir;
				case 'sevenM': return (a.stats.goals_7m - b.stats.goals_7m) * dir;
				case 'tm': return (a.stats.tech_mistakes - b.stats.tech_mistakes) * dir;
				case 'twoMin': return (a.stats.suspensions_2min - b.stats.suspensions_2min) * dir;
				default: return 0;
			}
		});
		return rows;
	});

	const sortedGoalies = $derived.by(() => {
		const rows = players
			.filter(p => isGoaliePosition(p.position) && aggregatedStats.has(p.id))
			.map(p => {
				const s = aggregatedStats.get(p.id)!;
				const tf = s.saves + s.conceded;
				const t7 = s.saves_7m + s.conceded_7m;
				return { player: p, stats: s, tf, t7, saveRate: tf > 0 ? s.saves / tf : 0, sevenMRate: t7 > 0 ? s.saves_7m / t7 : 0 };
			});
		const { key, asc } = goalieSort;
		const dir = asc ? 1 : -1;
		rows.sort((a, b) => {
			switch (key) {
				case 'number': return (a.player.number - b.player.number) * dir;
				case 'name': return a.player.name.localeCompare(b.player.name) * dir;
				case 'gp': return (a.stats.gamesPlayed - b.stats.gamesPlayed) * dir;
				case 'saves': return (a.stats.saves - b.stats.saves) * dir;
				case 'conceded': return (a.stats.conceded - b.stats.conceded) * dir;
				case 'saveRate': return (a.saveRate - b.saveRate) * dir;
				case 'sevenMSv': return (a.stats.saves_7m - b.stats.saves_7m) * dir;
				case 'sevenMCon': return (a.stats.conceded_7m - b.stats.conceded_7m) * dir;
				case 'sevenMRate': return (a.sevenMRate - b.sevenMRate) * dir;
				default: return 0;
			}
		});
		return rows;
	});

	let loadError = $state(false);

	async function load() {
		loadError = false;
		loading = true;
		try {
			const [p, g, s, ev] = await Promise.all([
				api.players.list(),
				api.games.list(),
				api.seasons.list(),
				api.events.list({ status: 'finished' })
			]);
			players = p;
			games = g;
			seasons = s;
			allEvents = groupEventsByGame(ev);
		} catch {
			loadError = true;
		} finally {
			loading = false;
		}
	}

	onMount(load);
</script>

<svelte:head><title>{pageTitle(t('title.stats'))}</title></svelte:head>

<h1 class="text-2xl font-bold mb-6">{t('stats.title')}</h1>

{#if loading}
	<div class="text-center py-12"><span class="loading loading-spinner loading-lg"></span></div>
{:else if loadError}
	<div class="alert alert-error">
		<span>{t('common.loadError')}</span>
		<button class="btn btn-sm" onclick={load}>{t('common.retry')}</button>
	</div>
{:else if finishedGames.length === 0}
	<div class="text-center text-base-content/60 py-12">
		<p class="text-lg">{t('stats.noGames')}</p>
	</div>
{:else}
	<!-- Season filter -->
	{#if seasons.length > 1}
		<div class="flex justify-end mb-4">
			<select class="select select-bordered select-sm" bind:value={selectedSeasonId}>
				<option value="all">{t('stats.allSeasons')}</option>
				{#each seasons as season}
					<option value={season.id}>{season.name}</option>
				{/each}
			</select>
		</div>
	{/if}

	<!-- Season overview -->
	<div class="stats stats-horizontal shadow mb-6 w-full">
		<div class="stat">
			<div class="stat-title">{t('stats.games')}</div>
			<div class="stat-value">{finishedGames.length}</div>
		</div>
		<div class="stat">
			<div class="stat-title">{t('stats.record')}</div>
			<div class="stat-value text-lg">{record.wins}{t('common.win')} {record.draws}{t('common.draw')} {record.losses}{t('common.loss')}</div>
		</div>
	</div>

	<!-- Charts -->
	<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
		{#if wdlChart}
			<div class="card bg-base-200">
				<div class="card-body">
					<h3 class="card-title text-sm">{t('chart.winDrawLoss')}</h3>
					<ChartWrapper type="doughnut" data={wdlChart.data} options={wdlChart.options} height="14rem" />
				</div>
			</div>
		{/if}
		{#if goalDiffChart}
			<div class="card bg-base-200">
				<div class="card-body">
					<h3 class="card-title text-sm">{t('chart.goalDifferential')}</h3>
					<ChartWrapper type="bar" data={goalDiffChart.data} options={goalDiffChart.options} height="14rem" />
				</div>
			</div>
		{/if}
		{#if topScorersChart}
			<div class="card bg-base-200">
				<div class="card-body">
					<h3 class="card-title text-sm">{t('chart.topScorers')}</h3>
					<ChartWrapper type="bar" data={topScorersChart.data} options={topScorersChart.options} height="14rem" />
				</div>
			</div>
		{/if}
		{#if efficiencyChart}
			<div class="card bg-base-200">
				<div class="card-body">
					<h3 class="card-title text-sm">{t('chart.efficiencyTrend')}</h3>
					<ChartWrapper type="line" data={efficiencyChart.data} options={efficiencyChart.options} height="14rem" />
				</div>
			</div>
		{/if}
	</div>

	<!-- Field player stats -->
	<div class="card bg-base-200 mb-6">
		<div class="card-body">
			<h3 class="card-title">{t('stats.fieldPlayers')}</h3>
			<div class="overflow-x-auto">
				<table class="table table-sm">
					<thead>
						<tr>
							<th class="sticky left-0 bg-base-200 z-10"><button class="flex items-center gap-1" onclick={() => toggleFieldSort('number')}>{t('table.number')}{#if fieldSort.key === 'number'}<span class="text-xs">{fieldSort.asc ? '▲' : '▼'}</span>{/if}</button></th>
							<th class="sticky left-8 bg-base-200 z-10"><button class="flex items-center gap-1" onclick={() => toggleFieldSort('name')}>{t('table.name')}{#if fieldSort.key === 'name'}<span class="text-xs">{fieldSort.asc ? '▲' : '▼'}</span>{/if}</button></th>
							<th><button class="flex items-center gap-1" onclick={() => toggleFieldSort('gp')}>{t('table.gp')}{#if fieldSort.key === 'gp'}<span class="text-xs">{fieldSort.asc ? '▲' : '▼'}</span>{/if}</button></th>
							<th><button class="flex items-center gap-1" onclick={() => toggleFieldSort('goals')}>{t('table.goals')}{#if fieldSort.key === 'goals'}<span class="text-xs">{fieldSort.asc ? '▲' : '▼'}</span>{/if}</button></th>
							<th><button class="flex items-center gap-1" onclick={() => toggleFieldSort('misses')}>{t('table.misses')}{#if fieldSort.key === 'misses'}<span class="text-xs">{fieldSort.asc ? '▲' : '▼'}</span>{/if}</button></th>
							<th><button class="flex items-center gap-1" onclick={() => toggleFieldSort('rate')}>{t('table.rate')}{#if fieldSort.key === 'rate'}<span class="text-xs">{fieldSort.asc ? '▲' : '▼'}</span>{/if}</button></th>
							<th><button class="flex items-center gap-1" onclick={() => toggleFieldSort('sevenM')}>{t('table.sevenM')}{#if fieldSort.key === 'sevenM'}<span class="text-xs">{fieldSort.asc ? '▲' : '▼'}</span>{/if}</button></th>
							<th><button class="flex items-center gap-1" onclick={() => toggleFieldSort('tm')}>{t('table.tm')}{#if fieldSort.key === 'tm'}<span class="text-xs">{fieldSort.asc ? '▲' : '▼'}</span>{/if}</button></th>
							<th><button class="flex items-center gap-1" onclick={() => toggleFieldSort('twoMin')}>{t('table.twoMin')}{#if fieldSort.key === 'twoMin'}<span class="text-xs">{fieldSort.asc ? '▲' : '▼'}</span>{/if}</button></th>
						</tr>
					</thead>
					<tbody>
						{#each sortedFieldPlayers as { player, stats: s, goals, misses, total }}
							<tr>
								<td class="font-bold sticky left-0 bg-base-200 z-10">{player.number}</td>
								<td class="sticky left-8 bg-base-200 z-10">{player.name}</td>
								<td>{s.gamesPlayed}</td>
								<td>{goals}</td>
								<td>{misses}</td>
								<td>{total > 0 ? Math.round((goals / total) * 100) + '%' : '-'}</td>
								<td>{s.goals_7m}/{s.goals_7m + s.misses_7m}</td>
								<td>{s.tech_mistakes}</td>
								<td>{s.suspensions_2min}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	</div>

	<!-- Goalie stats -->
	<div class="card bg-base-200">
		<div class="card-body">
			<h3 class="card-title">{t('stats.goalies')}</h3>
			<div class="overflow-x-auto">
				<table class="table table-sm">
					<thead>
						<tr>
							<th class="sticky left-0 bg-base-200 z-10"><button class="flex items-center gap-1" onclick={() => toggleGoalieSort('number')}>{t('table.number')}{#if goalieSort.key === 'number'}<span class="text-xs">{goalieSort.asc ? '▲' : '▼'}</span>{/if}</button></th>
							<th class="sticky left-8 bg-base-200 z-10"><button class="flex items-center gap-1" onclick={() => toggleGoalieSort('name')}>{t('table.name')}{#if goalieSort.key === 'name'}<span class="text-xs">{goalieSort.asc ? '▲' : '▼'}</span>{/if}</button></th>
							<th><button class="flex items-center gap-1" onclick={() => toggleGoalieSort('gp')}>{t('table.gp')}{#if goalieSort.key === 'gp'}<span class="text-xs">{goalieSort.asc ? '▲' : '▼'}</span>{/if}</button></th>
							<th><button class="flex items-center gap-1" onclick={() => toggleGoalieSort('saves')}>{t('table.saves')}{#if goalieSort.key === 'saves'}<span class="text-xs">{goalieSort.asc ? '▲' : '▼'}</span>{/if}</button></th>
							<th><button class="flex items-center gap-1" onclick={() => toggleGoalieSort('conceded')}>{t('table.conceded')}{#if goalieSort.key === 'conceded'}<span class="text-xs">{goalieSort.asc ? '▲' : '▼'}</span>{/if}</button></th>
							<th><button class="flex items-center gap-1" onclick={() => toggleGoalieSort('saveRate')}>{t('table.saveRate')}{#if goalieSort.key === 'saveRate'}<span class="text-xs">{goalieSort.asc ? '▲' : '▼'}</span>{/if}</button></th>
							<th><button class="flex items-center gap-1" onclick={() => toggleGoalieSort('sevenMSv')}>{t('table.sevenMSv')}{#if goalieSort.key === 'sevenMSv'}<span class="text-xs">{goalieSort.asc ? '▲' : '▼'}</span>{/if}</button></th>
							<th><button class="flex items-center gap-1" onclick={() => toggleGoalieSort('sevenMCon')}>{t('table.sevenMCon')}{#if goalieSort.key === 'sevenMCon'}<span class="text-xs">{goalieSort.asc ? '▲' : '▼'}</span>{/if}</button></th>
							<th><button class="flex items-center gap-1" onclick={() => toggleGoalieSort('sevenMRate')}>{t('table.sevenMRate')}{#if goalieSort.key === 'sevenMRate'}<span class="text-xs">{goalieSort.asc ? '▲' : '▼'}</span>{/if}</button></th>
						</tr>
					</thead>
					<tbody>
						{#each sortedGoalies as { player, stats: s, tf, t7 }}
							<tr>
								<td class="font-bold sticky left-0 bg-base-200 z-10">{player.number}</td>
								<td class="sticky left-8 bg-base-200 z-10">{player.name}</td>
								<td>{s.gamesPlayed}</td>
								<td>{s.saves}</td>
								<td>{s.conceded}</td>
								<td>{tf > 0 ? Math.round((s.saves / tf) * 100) + '%' : '-'}</td>
								<td>{s.saves_7m}</td>
								<td>{s.conceded_7m}</td>
								<td>{t7 > 0 ? Math.round((s.saves_7m / t7) * 100) + '%' : '-'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	</div>
{/if}
