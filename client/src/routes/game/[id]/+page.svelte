<script lang="ts">
	import { newId } from '$lib/id';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api, ApiError } from '$lib/api';
	import { outbox } from '$lib/outbox.svelte';
	import { pageTitle } from '$lib/session.svelte';
	import {
		type Game,
		type Player,
		type GameEvent,
		type EventType,
		type ShotZone,
		type Half,
		type PlayerGameStats,
		computePlayerStats,
		teamScore,
		opponentScore,
		isGoaliePosition
	} from '@shared/types';
	import PlayerTile from '$components/PlayerTile.svelte';
	import ActionOverlay from '$components/ActionOverlay.svelte';
	import GoalieSelectOverlay from '$components/GoalieSelectOverlay.svelte';
	import { t } from '$lib/i18n/index.svelte';
	import ConfirmDialog from '$components/ConfirmDialog.svelte';
	import UndoToast from '$components/UndoToast.svelte';
	import { getChartColors } from '$lib/chart-setup';
	import { buildScoreProgressionData } from '$lib/chart-data';
	import ChartWrapper from '$components/ChartWrapper.svelte';

	let game = $state<Game | undefined>();
	let rosterPlayers = $state<Player[]>([]);
	let events = $state<GameEvent[]>([]);
	let selectedPlayer = $state<Player | null>(null);
	let showStats = $state(false);
	let loadError = $state(false);

	// Goalie select state for opponent goals
	let pendingOpponentEvent = $state<'opponent_goal' | 'opponent_7m' | null>(null);
	let showConfirmDialog = $state(false);
	let pendingTransition = $state<{ next: string; confirmMsg: string } | null>(null);
	let flashMap = $state<Map<string, string>>(new Map());
	let undoMessage = $state('');

	const goalies = $derived(rosterPlayers.filter((p) => isGoaliePosition(p.position)));
	const fieldPlayers = $derived(rosterPlayers.filter((p) => !isGoaliePosition(p.position)));
	const ownScore = $derived(teamScore(events));
	const oppScore = $derived(opponentScore(events));

	const playerStatsMap = $derived.by(() => {
		const map = new Map<string, PlayerGameStats>();
		for (const p of rosterPlayers) {
			map.set(p.id, computePlayerStats(events, p.id));
		}
		return map;
	});

	const currentHalf = $derived<Half>(
		game?.status === 'second_half' ? 2 : 1
	);

	const statusLabel = $derived.by(() => {
		switch (game?.status) {
			case 'first_half': return t('game.firstHalf');
			case 'second_half': return t('game.secondHalf');
			case 'finished': return t('game.finished');
			default: return '';
		}
	});

	async function load() {
		loadError = false;
		try {
			const detail = outbox.applyTo(await api.games.get(page.params.id!));
			game = detail.game;
			rosterPlayers = detail.roster;
			events = detail.events;
		} catch (e) {
			if (e instanceof ApiError && e.status === 404) {
				goto('/');
				return;
			}
			loadError = true;
		}
	}

	onMount(() => {
		outbox.resume();
		void load();
	});

	function vibrate() {
		if (navigator.vibrate) navigator.vibrate(30);
	}

	function flashPlayer(playerId: string, type: string) {
		flashMap.set(playerId, type);
		flashMap = new Map(flashMap);
		setTimeout(() => {
			flashMap.delete(playerId);
			flashMap = new Map(flashMap);
		}, 600);
	}

	function makeEvent(eventType: EventType, playerId: string | null, shotZone: ShotZone | null): GameEvent {
		return {
			id: newId(),
			game_id: game!.id,
			player_id: playerId,
			timestamp: new Date().toISOString(),
			half: currentHalf,
			event_type: eventType,
			shot_zone: shotZone
		};
	}

	/** Apply events optimistically and queue them as ONE outbox operation (paired events stay together). */
	function commitEvents(newEvents: GameEvent[]) {
		if (!game || newEvents.length === 0) return;
		events = [...events, ...newEvents];
		outbox.enqueue({
			kind: 'addEvents',
			gameId: game.id,
			events: newEvents.map(({ game_id: _gameId, ...rest }) => rest)
		});
		vibrate();
	}

	function handlePlayerAction(eventType: EventType, shotZone: ShotZone | null) {
		if (!selectedPlayer || !game) return;
		const playerId = selectedPlayer.id;
		const batch: GameEvent[] = [makeEvent(eventType, playerId, shotZone)];

		// Goalie conceded -> also log opponent goal (so score updates)
		if (eventType === 'conceded') {
			batch.push(makeEvent('opponent_goal', null, null));
		} else if (eventType === 'conceded_7m') {
			batch.push(makeEvent('opponent_7m', null, null));
		}

		// Auto red card on 3rd 2-minute suspension
		if (eventType === 'suspension_2min') {
			const stats = playerStatsMap.get(playerId);
			if (stats && stats.suspensions_2min + 1 >= 3) {
				batch.push(makeEvent('red_card', playerId, null));
			}
		}

		commitEvents(batch);

		// Visual feedback flash
		const flashType =
			eventType === 'goal' || eventType === 'goal_7m' ? 'goal' :
			eventType === 'miss' || eventType === 'miss_7m' || eventType === 'tech_mistake' ? 'miss' :
			eventType === 'yellow_card' || eventType === 'suspension_2min' || eventType === 'red_card' ? 'card' :
			eventType === 'save' || eventType === 'save_7m' ? 'goal' :
			eventType === 'conceded' || eventType === 'conceded_7m' ? 'miss' : '';
		if (flashType) flashPlayer(playerId, flashType);

		selectedPlayer = null;
	}

	function logOpponentEvent(type: 'opponent_goal' | 'opponent_7m', goalieId: string | null) {
		const batch = [makeEvent(type, null, null)];
		if (goalieId) {
			const concededType: EventType = type === 'opponent_goal' ? 'conceded' : 'conceded_7m';
			batch.push(makeEvent(concededType, goalieId, null));
		}
		commitEvents(batch);
	}

	function handleOpponentGoal(type: 'opponent_goal' | 'opponent_7m') {
		if (goalies.length === 1) {
			logOpponentEvent(type, goalies[0].id);
		} else if (goalies.length > 1) {
			pendingOpponentEvent = type;
		} else {
			logOpponentEvent(type, null);
		}
	}

	function handleGoalieSelected(goalieId: string) {
		if (!pendingOpponentEvent) return;
		logOpponentEvent(pendingOpponentEvent, goalieId);
		pendingOpponentEvent = null;
	}

	function undo() {
		if (!game || events.length === 0) return;
		const last = events[events.length - 1];
		const removed = [last];

		const pairedTypes = new Set(['opponent_goal', 'opponent_7m', 'conceded', 'conceded_7m']);
		if (pairedTypes.has(last.event_type) && events.length > 1) {
			const secondLast = events[events.length - 2];
			if (pairedTypes.has(secondLast.event_type)) removed.push(secondLast);
		}

		events = events.slice(0, events.length - removed.length);
		outbox.enqueue({ kind: 'deleteEvents', gameId: game.id, ids: removed.map((e) => e.id) });
		vibrate();

		// Show undo toast feedback
		const eventLabel = t(`event.${last.event_type}` as any);
		const player = last.player_id ? rosterPlayers.find(p => p.id === last.player_id) : null;
		undoMessage = player
			? t('game.undoToastPlayer', { event: eventLabel, player: `#${player.number} ${player.name}` })
			: t('game.undoToast', { event: eventLabel });
	}

	function advanceStatus() {
		if (!game) return;
		const transitions: Record<string, { next: string; confirmMsg: string }> = {
			first_half: { next: 'second_half', confirmMsg: t('game.confirmEndFirstHalf') },
			second_half: { next: 'finished', confirmMsg: t('game.confirmEndGame') }
		};
		const tr = transitions[game.status];
		if (!tr) return;
		const warning = outbox.pending > 0 ? ' ' + t('save.endWarning', { count: outbox.pending }) : '';
		pendingTransition = { next: tr.next, confirmMsg: tr.confirmMsg + warning };
		showConfirmDialog = true;
	}

	function doAdvance() {
		if (!game || !pendingTransition) return;
		showConfirmDialog = false;
		const nextStatus = pendingTransition.next as Game['status'];
		pendingTransition = null;
		game = { ...game, status: nextStatus };
		outbox.enqueue({ kind: 'updateGame', gameId: game.id, patch: { status: nextStatus } });

		if (nextStatus === 'finished') {
			goto(`/game/${game.id}/summary`);
		}
	}

	const teamSummary = $derived.by(() => {
		let goals = 0, misses = 0, tm = 0, susp = 0;
		for (const p of fieldPlayers) {
			const s = playerStatsMap.get(p.id)!;
			if (!s) continue;
			goals += s.goals + s.goals_7m;
			misses += s.misses + s.misses_7m;
			tm += s.tech_mistakes;
			susp += s.suspensions_2min;
		}
		const total = goals + misses;
		return { goals, misses, rate: total > 0 ? Math.round((goals / total) * 100) : 0, tm, susp };
	});

	const scoreChart = $derived.by(() => {
		if (events.length === 0) return null;
		const colors = getChartColors();
		return buildScoreProgressionData(events, t('chart.team'), t('chart.opponent'), colors);
	});

	const advanceLabel = $derived.by(() => {
		switch (game?.status) {
			case 'first_half': return t('game.advanceSecondHalf');
			case 'second_half': return t('game.advanceEndGame');
			default: return '';
		}
	});
</script>

<svelte:head><title>{pageTitle(t('title.gameTracking'))}</title></svelte:head>

{#if loadError}
	<div class="flex flex-col items-center justify-center h-screen gap-4">
		<p>{t('common.loadError')}</p>
		<button class="btn btn-primary" onclick={load}>{t('common.retry')}</button>
	</div>
{:else if !game}
	<div class="flex items-center justify-center h-screen">
		<span class="loading loading-spinner loading-lg"></span>
	</div>
{:else if showStats}
	<!-- Stats view -->
	<div class="min-h-screen bg-base-100 p-2">
		<div class="flex justify-between items-center mb-4 px-2">
			<div class="text-xl font-bold">
				{ownScore} : {oppScore}
				<span class="text-base-content/60 text-sm ml-2">vs {game.opponent}</span>
			</div>
			<button class="btn btn-primary btn-sm" onclick={() => (showStats = false)}>{t('game.tracking')}</button>
		</div>

		<!-- Score progression chart -->
		{#if scoreChart}
			<div class="card bg-base-200 mb-4">
				<div class="card-body py-3">
					<h3 class="card-title text-sm">{t('chart.scoreProgression')}</h3>
					<ChartWrapper type="line" data={scoreChart.data} options={scoreChart.options} height="12rem" />
				</div>
			</div>
		{/if}

		<!-- Field player stats -->
		<div class="overflow-x-auto mb-4">
			<table class="table table-xs">
				<thead>
					<tr>
						<th class="sticky left-0 bg-base-100 z-10">{t('table.number')}</th>
						<th class="sticky left-8 bg-base-100 z-10">{t('table.name')}</th>
						<th>{t('table.g')}</th>
						<th>{t('table.m')}</th>
						<th>%</th>
						<th>{t('table.sevenM')}</th>
						<th>{t('table.tm')}</th>
						<th>{t('table.twoMin')}</th>
					</tr>
				</thead>
				<tbody>
					{#each rosterPlayers.filter((p) => !isGoaliePosition(p.position)) as player}
						{@const s = playerStatsMap.get(player.id)!}
						{@const totalThrows = s.goals + s.misses + s.goals_7m + s.misses_7m}
						{@const totalGoals = s.goals + s.goals_7m}
						<tr>
							<td class="font-bold sticky left-0 bg-base-100 z-10">{player.number}</td>
							<td class="sticky left-8 bg-base-100 z-10">{player.name}</td>
							<td>{totalGoals}</td>
							<td>{s.misses + s.misses_7m}</td>
							<td>{totalThrows > 0 ? Math.round((totalGoals / totalThrows) * 100) + '%' : '-'}</td>
							<td>{s.goals_7m}/{s.goals_7m + s.misses_7m}</td>
							<td>{s.tech_mistakes}</td>
							<td>{s.suspensions_2min}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<!-- Goalie stats -->
		<div class="overflow-x-auto mb-4">
			<table class="table table-xs">
				<thead>
					<tr>
						<th class="sticky left-0 bg-base-100 z-10">{t('table.number')}</th>
						<th class="sticky left-8 bg-base-100 z-10">{t('table.name')}</th>
						<th>{t('table.sv')}</th>
						<th>{t('table.con')}</th>
						<th>%</th>
						<th>{t('table.sevenMSv')}</th>
						<th>{t('table.sevenMCon')}</th>
						<th>{t('table.sevenMRate')}</th>
					</tr>
				</thead>
				<tbody>
					{#each rosterPlayers.filter((p) => isGoaliePosition(p.position)) as player}
						{@const s = playerStatsMap.get(player.id)!}
						{@const totalField = s.saves + s.conceded}
						{@const total7m = s.saves_7m + s.conceded_7m}
						<tr>
							<td class="font-bold sticky left-0 bg-base-100 z-10">{player.number}</td>
							<td class="sticky left-8 bg-base-100 z-10">{player.name}</td>
							<td>{s.saves}</td>
							<td>{s.conceded}</td>
							<td>{totalField > 0 ? Math.round((s.saves / totalField) * 100) + '%' : '-'}</td>
							<td>{s.saves_7m}</td>
							<td>{s.conceded_7m}</td>
							<td>{total7m > 0 ? Math.round((s.saves_7m / total7m) * 100) + '%' : '-'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<!-- Team summary -->
		<div class="card bg-base-200 p-4">
			<div class="text-sm">
				<strong>{t('game.team')}:</strong> {teamSummary.goals} {t('game.goals')}, {teamSummary.misses} {t('game.misses')}
				({teamSummary.rate}%)
				&middot; {t('table.tm')}: {teamSummary.tm} &middot; 2min: {teamSummary.susp} ({teamSummary.susp * 2}min)
			</div>
		</div>
	</div>
{:else}
	<!-- Tracking view -->
	<div class="h-[100dvh] bg-base-100 p-2 flex flex-col overflow-hidden">
		<!-- Score header -->
		<div class="mb-3 px-2">
			<!-- Row 1: Score + status badge (always centered) -->
			<div class="flex justify-center items-center gap-3">
				<span class="text-3xl sm:text-2xl font-bold tabular-nums">{ownScore} : {oppScore}</span>
				<span class="badge badge-lg">{statusLabel}</span>
			</div>
			<!-- Row 2: Opponent + action buttons -->
			<div class="flex justify-between items-center mt-1">
				<div class="flex items-center gap-2 min-w-0">
					<span class="text-base-content/60 text-sm truncate">vs {game.opponent}</span>
					{@render saveBadge()}
				</div>
				<div class="flex gap-1 sm:gap-2 shrink-0">
					<a href="/" class="btn btn-ghost btn-sm btn-square" aria-label={t('game.home')}>
						<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1" />
						</svg>
					</a>
					<button class="btn btn-ghost btn-sm btn-square" onclick={() => (showStats = true)} aria-label={t('game.stats')}>
						<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
						</svg>
					</button>
					<button class="btn btn-warning btn-sm" onclick={undo} disabled={events.length === 0}>{t('game.undo')}</button>
				</div>
			</div>
		</div>

		<!-- Field players -->
		<div class="flex-1 min-h-0 mb-2 flex flex-col">
			<div class="text-xs text-base-content/40 uppercase tracking-wide mb-1 px-1 shrink-0">{t('game.fieldPlayers')}</div>
			<div class="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 gap-2 content-start flex-1 min-h-0">
				{#each fieldPlayers as player}
					{@const stats = playerStatsMap.get(player.id)!}
					<PlayerTile {player} {stats} onclick={() => (selectedPlayer = player)} flashClass={flashMap.get(player.id) ?? ''} />
				{/each}
			</div>
		</div>

		<!-- Goalkeepers -->
		<div class="mb-2 mt-auto">
			<div class="text-xs text-base-content/40 uppercase tracking-wide mb-1 px-1">{t('game.goalkeepers')}</div>
			<div class="grid grid-cols-3 sm:grid-cols-4 gap-2">
				{#each goalies as player}
					{@const stats = playerStatsMap.get(player.id)!}
					<PlayerTile {player} {stats} onclick={() => (selectedPlayer = player)} flashClass={flashMap.get(player.id) ?? ''} />
				{/each}
			</div>
		</div>

		<!-- Bottom bar -->
		<div class="flex gap-2 flex-wrap">
			<button class="btn btn-error flex-1" onclick={() => handleOpponentGoal('opponent_goal')}>
				{t('game.oppGoal')}
			</button>
			<button class="btn btn-error btn-outline flex-1" onclick={() => handleOpponentGoal('opponent_7m')}>
				{t('game.opp7m')}
			</button>
			{#if game.status === 'finished'}
				<a href="/game/{game.id}/summary" class="btn btn-primary flex-1">{t('game.summary')}</a>
			{:else}
				<button class="btn btn-accent flex-1" onclick={advanceStatus}>
					{advanceLabel}
				</button>
			{/if}
		</div>
	</div>

	<!-- Overlays -->
	{#if selectedPlayer}
		<ActionOverlay
			player={selectedPlayer}
			onaction={handlePlayerAction}
			onclose={() => (selectedPlayer = null)}
		/>
	{/if}

	{#if pendingOpponentEvent}
		<GoalieSelectOverlay
			{goalies}
			eventLabel={pendingOpponentEvent === 'opponent_goal' ? t('game.opponentGoal') : t('game.opponent7m')}
			onselect={handleGoalieSelected}
			onclose={() => (pendingOpponentEvent = null)}
		/>
	{/if}

	{#if showConfirmDialog && pendingTransition}
		<ConfirmDialog
			message={pendingTransition.confirmMsg}
			onconfirm={doAdvance}
			oncancel={() => { showConfirmDialog = false; pendingTransition = null; }}
		/>
	{/if}

{/if}

{#snippet saveBadge()}
	{#if outbox.sessionExpired}
		<a href="/login?next={encodeURIComponent(page.url.pathname)}" class="badge badge-error badge-sm shrink-0 whitespace-nowrap">
			{t('save.sessionExpired', { count: outbox.pending })} &middot; {t('save.login')}
		</a>
	{:else if outbox.lastError}
		<button class="badge badge-error badge-sm shrink-0" onclick={() => outbox.dismissError()}>
			{t('save.failed', { error: outbox.lastError })}
		</button>
	{:else if outbox.retrying}
		<span class="badge badge-warning badge-sm shrink-0 whitespace-nowrap" role="status">{t('save.retrying', { count: outbox.pending })}</span>
	{:else if outbox.ops.length > 0}
		<span class="badge badge-warning badge-sm shrink-0 whitespace-nowrap" role="status">{t('save.pending', { count: outbox.pending })}</span>
	{:else}
		<span class="badge badge-success badge-outline badge-sm shrink-0" role="status">{t('save.allSaved')}</span>
	{/if}
{/snippet}

{#if undoMessage}
	<UndoToast
		message={undoMessage}
		ondismiss={() => { undoMessage = ''; }}
	/>
{/if}
