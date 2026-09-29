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
		isGoaliePosition
	} from '@shared/types';
	import { t } from '$lib/i18n/index.svelte';
	import { formatDate } from '$lib/format';

	let game = $state<Game | undefined>();
	let rosterPlayers = $state<Player[]>([]);
	let events = $state<GameEvent[]>([]);
	let notes = $state('');

	const ownScore = $derived(teamScore(events));
	const oppScore = $derived(opponentScore(events));

	let loadError = $state(false);
	let saving = $state(false);
	let notSaved = $state(false);

	async function load() {
		loadError = false;
		try {
			// Include queued operations so the just-finished game is shown complete even if
			// the server has not received the last events yet.
			const detail = outbox.applyTo(await api.games.get(page.params.id!));
			game = detail.game;
			rosterPlayers = detail.roster;
			events = detail.events;
			notes = game.notes || '';
		} catch (e) {
			if (e instanceof ApiError && e.status === 404) {
				goto('/');
				return;
			}
			loadError = true;
		}
	}

	onMount(load);

	async function finish() {
		if (!game || saving) return;
		saving = true;
		notSaved = false;
		// The outbox keeps ordering with the status change / events from live tracking.
		outbox.enqueue({ kind: 'updateGame', gameId: game.id, patch: { notes } });
		const done = await outbox.whenIdle(4000);
		saving = false;
		if (done) goto('/');
		else notSaved = true;
	}
</script>

<svelte:head><title>{pageTitle(t('title.gameSummary'))}</title></svelte:head>

<div class="flex flex-col gap-6">
	{#if loadError}
		<div class="alert alert-error">
			<span>{t('common.loadError')}</span>
			<button class="btn btn-sm" onclick={load}>{t('common.retry')}</button>
		</div>
	{:else if game}
		<div class="text-center py-4">
			<h1 class="text-3xl font-bold">{t('summary.title')}</h1>
			<p class="text-xl mt-2">
				<span class="font-bold">{ownScore} : {oppScore}</span>
				vs {game.opponent}
			</p>
			<p class="text-base-content/60">
				{formatDate(game.date)} &middot; {game.is_home ? t('common.home') : t('common.away')}
			</p>
		</div>

		<!-- Player stats -->
		<div class="card bg-base-200">
			<div class="card-body">
				<h3 class="card-title">{t('summary.playerStats')}</h3>
				<div class="overflow-x-auto">
					<table class="table table-sm">
						<thead>
							<tr>
								<th class="sticky left-0 bg-base-200 z-10">{t('table.number')}</th>
								<th class="sticky left-8 bg-base-200 z-10">{t('table.name')}</th>
								<th>{t('table.g')}</th>
								<th>{t('table.m')}</th>
								<th>%</th>
								<th>{t('table.sevenM')}</th>
								<th>{t('table.tm')}</th>
								<th>{t('table.twoMin')}</th>
								<th>{t('table.yc')}</th>
								<th>{t('table.rc')}</th>
							</tr>
						</thead>
						<tbody>
							{#each rosterPlayers.filter((p) => !isGoaliePosition(p.position)) as player}
								{@const s = computePlayerStats(events, player.id)}
								{@const total = s.goals + s.misses + s.goals_7m + s.misses_7m}
								{@const goals = s.goals + s.goals_7m}
								<tr>
									<td class="font-bold sticky left-0 bg-base-200 z-10">{player.number}</td>
									<td class="sticky left-8 bg-base-200 z-10">{player.name}</td>
									<td>{goals}</td>
									<td>{s.misses + s.misses_7m}</td>
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
				<h3 class="card-title">{t('summary.goalieStats')}</h3>
				<div class="overflow-x-auto">
					<table class="table table-sm">
						<thead>
							<tr>
								<th class="sticky left-0 bg-base-200 z-10">{t('table.number')}</th>
								<th class="sticky left-8 bg-base-200 z-10">{t('table.name')}</th>
								<th>{t('table.saves')}</th>
								<th>{t('table.conceded')}</th>
								<th>{t('table.saveRate')}</th>
								<th>{t('table.sevenMSv')}</th>
								<th>{t('table.sevenMCon')}</th>
								<th>{t('table.sevenMRate')}</th>
							</tr>
						</thead>
						<tbody>
							{#each rosterPlayers.filter((p) => isGoaliePosition(p.position)) as player}
								{@const s = computePlayerStats(events, player.id)}
								{@const totalField = s.saves + s.conceded}
								{@const total7m = s.saves_7m + s.conceded_7m}
								<tr>
									<td class="font-bold sticky left-0 bg-base-200 z-10">{player.number}</td>
									<td class="sticky left-8 bg-base-200 z-10">{player.name}</td>
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
			</div>
		</div>

		<!-- Notes -->
		<div class="card bg-base-200">
			<div class="card-body">
				<h3 class="card-title">{t('summary.gameNotes')}</h3>
				<textarea
					class="textarea textarea-bordered w-full h-32"
					placeholder={t('summary.notesPlaceholder')}
					bind:value={notes}
				></textarea>
				<p class="text-xs text-base-content/40">{t('summary.notesSaveHint')}</p>
			</div>
		</div>

		{#if notSaved}
			<div class="alert alert-warning"><span>{t('save.notSavedYet')}</span></div>
		{/if}

		<div class="flex gap-4">
			<a href="/game/{game.id}" class="btn btn-outline flex-1">{t('summary.viewTracking')}</a>
			<button class="btn btn-primary flex-1" onclick={finish} disabled={saving}>
				{#if saving}<span class="loading loading-spinner loading-sm"></span>{/if}
				{t('summary.done')}
			</button>
		</div>
	{/if}
</div>
