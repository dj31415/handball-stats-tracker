<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { api, ApiError } from '$lib/api';
	import { outbox } from '$lib/outbox.svelte';
	import { pageTitle } from '$lib/session.svelte';
	import {
		type Game,
		type Player,
		type GameEvent,
		computePlayerStats,
		teamScore,
		opponentScore,
		isGoaliePosition,
		SHOT_ZONES,
		type ShotZone
	} from '@shared/types';
	import { t } from '$lib/i18n/index.svelte';
	import { formatDate } from '$lib/format';
	import { getChartColors } from '$lib/chart-setup';
	import {
		buildScoreProgressionData,
		buildShotZonePolarData,
		buildGoalContributionData,
		buildHalfComparisonData
	} from '$lib/chart-data';
	import ChartWrapper from '$components/ChartWrapper.svelte';

	let game = $state<Game | undefined>();
	let rosterPlayers = $state<Player[]>([]);
	let events = $state<GameEvent[]>([]);

	const ownScore = $derived(teamScore(events));
	const oppScore = $derived(opponentScore(events));

	// Sorting state
	type FieldSortKey = 'number' | 'name' | 'goals' | 'misses' | 'rate' | 'sevenM' | 'tm' | 'twoMin' | 'yc' | 'rc';
	type GoalieSortKey = 'number' | 'name' | 'saves' | 'conceded' | 'saveRate' | 'sevenMSv' | 'sevenMCon' | 'sevenMRate';

	let fieldSort = $state<{ key: FieldSortKey; asc: boolean }>({ key: 'number', asc: true });
	let goalieSort = $state<{ key: GoalieSortKey; asc: boolean }>({ key: 'number', asc: true });

	function toggleFieldSort(key: FieldSortKey) {
		fieldSort = fieldSort.key === key ? { key, asc: !fieldSort.asc } : { key, asc: false };
	}
	function toggleGoalieSort(key: GoalieSortKey) {
		goalieSort = goalieSort.key === key ? { key, asc: !goalieSort.asc } : { key, asc: false };
	}

	const sortedFieldPlayers = $derived.by(() => {
		const rows = rosterPlayers
			.filter(p => !isGoaliePosition(p.position))
			.map(p => {
				const s = computePlayerStats(events, p.id);
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
				case 'goals': return (a.goals - b.goals) * dir;
				case 'misses': return (a.misses - b.misses) * dir;
				case 'rate': return (a.rate - b.rate) * dir;
				case 'sevenM': return (a.stats.goals_7m - b.stats.goals_7m) * dir;
				case 'tm': return (a.stats.tech_mistakes - b.stats.tech_mistakes) * dir;
				case 'twoMin': return (a.stats.suspensions_2min - b.stats.suspensions_2min) * dir;
				case 'yc': return (a.stats.yellow_cards - b.stats.yellow_cards) * dir;
				case 'rc': return (a.stats.red_cards - b.stats.red_cards) * dir;
				default: return 0;
			}
		});
		return rows;
	});

	const sortedGoalies = $derived.by(() => {
		const rows = rosterPlayers
			.filter(p => isGoaliePosition(p.position))
			.map(p => {
				const s = computePlayerStats(events, p.id);
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

	// Shot zone breakdown
	const zoneStats = $derived.by(() => {
		const zones: Record<ShotZone, { goals: number; misses: number }> = {} as any;
		for (const z of SHOT_ZONES) zones[z] = { goals: 0, misses: 0 };
		for (const e of events) {
			if (!e.shot_zone) continue;
			if (e.event_type === 'goal') zones[e.shot_zone].goals++;
			if (e.event_type === 'miss') zones[e.shot_zone].misses++;
		}
		return zones;
	});

	const chartColors = $derived(events.length > 0 ? getChartColors() : null);

	const scoreChart = $derived.by(() => {
		if (!chartColors) return null;
		return buildScoreProgressionData(events, t('chart.team'), t('chart.opponent'), chartColors);
	});

	const zonePolarChart = $derived.by(() => {
		if (!chartColors) return null;
		const zoneLabels = SHOT_ZONES.map((z) => t(`zone.${z}`));
		return buildShotZonePolarData(zoneStats, zoneLabels, chartColors);
	});

	const goalContributionChart = $derived.by(() => {
		if (!chartColors) return null;
		return buildGoalContributionData(events, rosterPlayers, chartColors);
	});

	const halfCompChart = $derived.by(() => {
		if (!chartColors) return null;
		return buildHalfComparisonData(events, {
			goals: t('chart.goals'),
			misses: t('chart.misses'),
			oppGoals: t('chart.oppGoals'),
			saves: t('chart.saves'),
			h1: t('chart.firstHalf'),
			h2: t('chart.secondHalf')
		}, chartColors);
	});

	let loadError = $state(false);

	async function load() {
		loadError = false;
		try {
			const detail = outbox.applyTo(await api.games.get(page.params.id!));
			game = detail.game;
			rosterPlayers = detail.roster;
			events = detail.events;
		} catch (e) {
			if (e instanceof ApiError && e.status === 404) {
				goto('/history');
				return;
			}
			loadError = true;
		}
	}

	onMount(load);
</script>

<svelte:head><title>{pageTitle(t('title.historyDetail'))}</title></svelte:head>

{#if loadError}
	<div class="alert alert-error">
		<span>{t('common.loadError')}</span>
		<button class="btn btn-sm" onclick={load}>{t('common.retry')}</button>
	</div>
{:else if game}
	<div class="flex flex-col gap-6">
		<div class="flex justify-between items-center">
			<div>
				<h1 class="text-2xl font-bold">vs {game.opponent}</h1>
				<p class="text-base-content/60">
					{formatDate(game.date)} &middot; {game.is_home ? t('common.home') : `${t('common.away')} (${game.location})`}
				</p>
			</div>
			<div class="text-3xl font-bold tabular-nums">{ownScore} : {oppScore}</div>
		</div>

		<!-- Field player stats -->
		<div class="card bg-base-200">
			<div class="card-body">
				<h3 class="card-title">{t('historyDetail.fieldPlayers')}</h3>
				<div class="overflow-x-auto">
					<table class="table table-sm">
						<thead>
							<tr>
								<th class="sticky left-0 bg-base-200 z-10"><button class="flex items-center gap-1" onclick={() => toggleFieldSort('number')}>{t('table.number')}{#if fieldSort.key === 'number'}<span class="text-xs">{fieldSort.asc ? '▲' : '▼'}</span>{/if}</button></th>
								<th class="sticky left-8 bg-base-200 z-10"><button class="flex items-center gap-1" onclick={() => toggleFieldSort('name')}>{t('table.name')}{#if fieldSort.key === 'name'}<span class="text-xs">{fieldSort.asc ? '▲' : '▼'}</span>{/if}</button></th>
								<th><button class="flex items-center gap-1" onclick={() => toggleFieldSort('goals')}>{t('table.goals')}{#if fieldSort.key === 'goals'}<span class="text-xs">{fieldSort.asc ? '▲' : '▼'}</span>{/if}</button></th>
								<th><button class="flex items-center gap-1" onclick={() => toggleFieldSort('misses')}>{t('table.misses')}{#if fieldSort.key === 'misses'}<span class="text-xs">{fieldSort.asc ? '▲' : '▼'}</span>{/if}</button></th>
								<th><button class="flex items-center gap-1" onclick={() => toggleFieldSort('rate')}>{t('table.rate')}{#if fieldSort.key === 'rate'}<span class="text-xs">{fieldSort.asc ? '▲' : '▼'}</span>{/if}</button></th>
								<th><button class="flex items-center gap-1" onclick={() => toggleFieldSort('sevenM')}>{t('table.sevenM')}{#if fieldSort.key === 'sevenM'}<span class="text-xs">{fieldSort.asc ? '▲' : '▼'}</span>{/if}</button></th>
								<th><button class="flex items-center gap-1" onclick={() => toggleFieldSort('tm')}>{t('table.tm')}{#if fieldSort.key === 'tm'}<span class="text-xs">{fieldSort.asc ? '▲' : '▼'}</span>{/if}</button></th>
								<th><button class="flex items-center gap-1" onclick={() => toggleFieldSort('twoMin')}>{t('table.twoMin')}{#if fieldSort.key === 'twoMin'}<span class="text-xs">{fieldSort.asc ? '▲' : '▼'}</span>{/if}</button></th>
								<th><button class="flex items-center gap-1" onclick={() => toggleFieldSort('yc')}>{t('table.yc')}{#if fieldSort.key === 'yc'}<span class="text-xs">{fieldSort.asc ? '▲' : '▼'}</span>{/if}</button></th>
								<th><button class="flex items-center gap-1" onclick={() => toggleFieldSort('rc')}>{t('table.rc')}{#if fieldSort.key === 'rc'}<span class="text-xs">{fieldSort.asc ? '▲' : '▼'}</span>{/if}</button></th>
							</tr>
						</thead>
						<tbody>
							{#each sortedFieldPlayers as { player, stats: s, goals, misses, total }}
								<tr>
									<td class="font-bold sticky left-0 bg-base-200 z-10">{player.number}</td>
									<td class="sticky left-8 bg-base-200 z-10">{player.name}</td>
									<td>{goals}</td>
									<td>{misses}</td>
									<td>{total > 0 ? Math.round((goals / total) * 100) + '%' : '-'}</td>
									<td>{s.goals_7m}/{s.goals_7m + s.misses_7m}</td>
									<td>{s.tech_mistakes}</td>
									<td>{s.suspensions_2min}</td>
									<td>{s.yellow_cards}</td>
									<td>{s.red_cards}</td>
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
				<h3 class="card-title">{t('historyDetail.goalies')}</h3>
				<div class="overflow-x-auto">
					<table class="table table-sm">
						<thead>
							<tr>
								<th class="sticky left-0 bg-base-200 z-10"><button class="flex items-center gap-1" onclick={() => toggleGoalieSort('number')}>{t('table.number')}{#if goalieSort.key === 'number'}<span class="text-xs">{goalieSort.asc ? '▲' : '▼'}</span>{/if}</button></th>
								<th class="sticky left-8 bg-base-200 z-10"><button class="flex items-center gap-1" onclick={() => toggleGoalieSort('name')}>{t('table.name')}{#if goalieSort.key === 'name'}<span class="text-xs">{goalieSort.asc ? '▲' : '▼'}</span>{/if}</button></th>
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

		<!-- Score progression chart -->
		{#if scoreChart}
			<div class="card bg-base-200">
				<div class="card-body">
					<h3 class="card-title">{t('chart.scoreProgression')}</h3>
					<ChartWrapper type="line" data={scoreChart.data} options={scoreChart.options} height="14rem" />
				</div>
			</div>
		{/if}

		<!-- Shot zones -->
		<div class="card bg-base-200">
			<div class="card-body">
				<h3 class="card-title">{t('historyDetail.shotZones')}</h3>
				<div class="grid grid-cols-3 sm:grid-cols-6 gap-3">
					{#each SHOT_ZONES as zone}
						{@const z = zoneStats[zone]}
						{@const total = z.goals + z.misses}
						<div class="text-center p-3 rounded-lg bg-base-300">
							<div class="font-bold text-sm">{t(`zone.${zone}`)}</div>
							<div class="text-lg">{z.goals}/{total}</div>
							<div class="text-xs text-base-content/60">
								{total > 0 ? Math.round((z.goals / total) * 100) + '%' : '-'}
							</div>
						</div>
					{/each}
				</div>
				{#if zonePolarChart}
				<ChartWrapper type="polarArea" data={zonePolarChart.data} options={zonePolarChart.options} height="16rem" />
			{/if}
			</div>
		</div>

		<!-- Goal contribution -->
		{#if goalContributionChart}
			<div class="card bg-base-200">
				<div class="card-body">
					<h3 class="card-title">{t('chart.goalContribution')}</h3>
					<ChartWrapper type="doughnut" data={goalContributionChart.data} options={goalContributionChart.options} height="14rem" />
				</div>
			</div>
		{/if}

		<!-- Half comparison -->
		{#if halfCompChart}
			<div class="card bg-base-200">
				<div class="card-body">
					<h3 class="card-title">{t('chart.halfComparison')}</h3>
					<ChartWrapper type="bar" data={halfCompChart.data} options={halfCompChart.options} height="12rem" />
				</div>
			</div>
		{/if}

		<!-- Notes -->
		{#if game.notes}
			<div class="card bg-base-200">
				<div class="card-body">
					<h3 class="card-title">{t('historyDetail.notes')}</h3>
					<p class="whitespace-pre-wrap">{game.notes}</p>
				</div>
			</div>
		{/if}

		<!-- Event log -->
		<div class="card bg-base-200">
			<div class="card-body">
				<h3 class="card-title">{t('historyDetail.eventLog')}</h3>
				<div class="max-h-64 overflow-y-auto">
					{#each [...events].reverse() as event}
						{@const player = rosterPlayers.find((p) => p.id === event.player_id)}
						<div class="flex justify-between text-sm py-1 border-b border-base-300">
							<span>
								<span class="badge badge-xs">{event.half === 1 ? t('historyDetail.firstHalf') : t('historyDetail.secondHalf')}</span>
								{t(`event.${event.event_type}`)}
								{#if player}— #{player.number} {player.name}{/if}
								{#if event.shot_zone}({t(`zone.${event.shot_zone}`)}){/if}
							</span>
							<span class="text-base-content/40">
								{new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
							</span>
						</div>
					{/each}
				</div>
			</div>
		</div>

		<a href="/history" class="btn btn-ghost">{t('history.backToHistory')}</a>
	</div>
{/if}
