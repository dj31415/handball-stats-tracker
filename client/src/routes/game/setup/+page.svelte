<script lang="ts">
	import { newId } from '$lib/id';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { api } from '$lib/api';
	import { pageTitle } from '$lib/session.svelte';
	import { isGoaliePosition, type Player, type Season, type GameStatus } from '@shared/types';
	import { t } from '$lib/i18n/index.svelte';
	import PromptDialog from '$components/PromptDialog.svelte';

	let showSeasonPrompt = $state(false);
	let players = $state<Player[]>([]);
	let seasons = $state<Season[]>([]);
	let pastOpponents = $state<string[]>([]);

	let opponent = $state('');
	let isHome = $state(true);
	let location = $state('');
	let gameDate = $state(new Date().toISOString().split('T')[0]);
	let selectedPlayerIds = $state<Set<string>>(new Set());
	let seasonId = $state('');

	let loadError = $state(false);
	let error = $state('');
	let starting = $state(false);
	// Stable id across retries, so a retried create can never produce a duplicate game.
	const gameId = newId();

	async function load() {
		loadError = false;
		try {
			const [p, s, games] = await Promise.all([
				api.players.list({ active: true }),
				api.seasons.list(),
				api.games.list()
			]);
			players = p;
			seasons = s;
			if (!seasonId && seasons.length > 0) {
				seasonId = seasons[seasons.length - 1].id;
			}
			pastOpponents = [...new Set(games.map((g) => g.opponent))].sort();
		} catch {
			loadError = true;
		}
	}

	onMount(load);

	function togglePlayer(id: string) {
		const next = new Set(selectedPlayerIds);
		if (next.has(id)) {
			next.delete(id);
		} else if (next.size < 16) {
			next.add(id);
		}
		selectedPlayerIds = next;
	}

	function selectAll() {
		if (players.length <= 16) {
			selectedPlayerIds = new Set(players.map((p) => p.id));
		}
	}

	function deselectAll() {
		selectedPlayerIds = new Set();
	}

	function createSeason() {
		showSeasonPrompt = true;
	}

	async function handleSeasonName(name: string) {
		showSeasonPrompt = false;
		error = '';
		try {
			const season = await api.seasons.create({
				id: newId(),
				name,
				start_date: gameDate
			});
			seasons = await api.seasons.list();
			seasonId = season.id;
		} catch {
			error = t('setup.seasonFailed');
		}
	}

	async function startGame() {
		if (!opponent.trim() || selectedPlayerIds.size === 0 || !seasonId || starting) return;
		starting = true;
		error = '';
		try {
			await api.games.create({
				id: gameId,
				season_id: seasonId,
				date: gameDate,
				opponent: opponent.trim(),
				is_home: isHome,
				location: isHome ? 'Home' : location.trim(),
				notes: '',
				status: 'first_half' as GameStatus,
				player_ids: [...selectedPlayerIds]
			});
			await goto(`/game/${gameId}`);
		} catch {
			error = t('setup.createFailed');
		} finally {
			starting = false;
		}
	}

	const canStart = $derived(opponent.trim() && selectedPlayerIds.size > 0 && seasonId);
</script>

<svelte:head><title>{pageTitle(t('title.gameSetup'))}</title></svelte:head>

<h1 class="text-2xl font-bold mb-6">{t('setup.title')}</h1>

{#if loadError}
	<div class="alert alert-error mb-4">
		<span>{t('common.loadError')}</span>
		<button class="btn btn-sm" onclick={load}>{t('common.retry')}</button>
	</div>
{/if}

<div class="flex flex-col gap-6">
	<!-- Season -->
	<div class="card bg-base-200">
		<div class="card-body">
			<h3 class="card-title">{t('setup.season')}</h3>
			{#if seasons.length === 0}
				<p class="text-base-content/60">{t('setup.noSeason')}</p>
				<button class="btn btn-primary btn-sm w-fit" onclick={createSeason}>{t('setup.createSeason')}</button>
			{:else}
				<div class="flex gap-4 items-end">
					<div class="form-control flex-1">
						<select class="select select-bordered" bind:value={seasonId}>
							{#each seasons as season}
								<option value={season.id}>{season.name}</option>
							{/each}
						</select>
					</div>
					<button class="btn btn-outline btn-sm" onclick={createSeason}>{t('setup.newSeason')}</button>
				</div>
			{/if}
		</div>
	</div>

	<!-- Game details -->
	<div class="card bg-base-200">
		<div class="card-body">
			<h3 class="card-title">{t('setup.gameDetails')}</h3>
			<div class="flex flex-wrap gap-4">
				<div class="form-control flex-1 min-w-48">
					<label class="label" for="opponent"><span class="label-text">{t('setup.opponent')}</span></label>
					<input
						id="opponent"
						type="text"
						class="input input-bordered"
						bind:value={opponent}
						placeholder={t('setup.opponentPlaceholder')}
						list="past-opponents"
					/>
					<datalist id="past-opponents">
						{#each pastOpponents as opp}
							<option value={opp}></option>
						{/each}
					</datalist>
				</div>
				<div class="form-control w-40">
					<label class="label" for="date"><span class="label-text">{t('setup.date')}</span></label>
					<input id="date" type="date" class="input input-bordered" bind:value={gameDate} />
				</div>
			</div>
			<div class="flex gap-4 mt-2">
				<label class="label cursor-pointer gap-2">
					<input type="radio" name="venue" class="radio radio-primary" checked={isHome} onchange={() => (isHome = true)} />
					<span class="label-text">{t('setup.home')}</span>
				</label>
				<label class="label cursor-pointer gap-2">
					<input type="radio" name="venue" class="radio radio-primary" checked={!isHome} onchange={() => (isHome = false)} />
					<span class="label-text">{t('setup.away')}</span>
				</label>
			</div>
			{#if !isHome}
				<div class="form-control">
					<label class="label" for="location"><span class="label-text">{t('setup.location')}</span></label>
					<input
						id="location"
						type="text"
						class="input input-bordered"
						bind:value={location}
						placeholder={t('setup.locationPlaceholder')}
					/>
				</div>
			{/if}
		</div>
	</div>

	<!-- Player selection -->
	<div class="card bg-base-200">
		<div class="card-body">
			<div class="flex justify-between items-center">
				<h3 class="card-title">
					{t('setup.selectPlayers')}
					<span class="badge badge-primary">{selectedPlayerIds.size}/16</span>
				</h3>
				<div class="flex gap-2">
					{#if players.length <= 16}
						<button class="btn btn-ghost btn-xs" onclick={selectAll}>{t('setup.all')}</button>
					{/if}
					<button class="btn btn-ghost btn-xs" onclick={deselectAll}>{t('setup.none')}</button>
				</div>
			</div>

			{#if players.length === 0}
				<p class="text-base-content/60">
					{t('setup.noActivePlayers')} <a href="/roster" class="link link-primary">{t('setup.addPlayersFirst')}</a>
				</p>
			{:else}
				{@const gkPlayers = players.filter(p => isGoaliePosition(p.position))}
				{@const fpPlayers = players.filter(p => !isGoaliePosition(p.position))}

				{#if gkPlayers.length > 0}
					<div class="text-xs text-base-content/40 uppercase tracking-wide mt-2 mb-1">{t('setup.goalkeepers')}</div>
					<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
						{#each gkPlayers as player}
							{@const selected = selectedPlayerIds.has(player.id)}
							<button
								class="btn btn-outline h-auto py-3 flex flex-col gap-0"
								class:btn-accent={selected}
								class:btn-active={selected}
								onclick={() => togglePlayer(player.id)}
								disabled={!selected && selectedPlayerIds.size >= 16}
							>
								<span class="text-lg font-bold">#{player.number}</span>
								<span class="text-xs">{player.name}</span>
								<span class="text-xs opacity-60">{t(`pos.${player.position}`)}</span>
							</button>
						{/each}
					</div>
				{/if}

				<div class="text-xs text-base-content/40 uppercase tracking-wide mt-3 mb-1">{t('setup.fieldPlayers')}</div>
				<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
					{#each fpPlayers as player}
						{@const selected = selectedPlayerIds.has(player.id)}
						<button
							class="btn btn-outline h-auto py-3 flex flex-col gap-0"
							class:btn-primary={selected}
							class:btn-active={selected}
							onclick={() => togglePlayer(player.id)}
							disabled={!selected && selectedPlayerIds.size >= 16}
						>
							<span class="text-lg font-bold">#{player.number}</span>
							<span class="text-xs">{player.name}</span>
							<span class="text-xs opacity-60">{t(`pos.${player.position}`)}</span>
						</button>
					{/each}
				</div>
			{/if}
		</div>
	</div>

	<!-- Start button -->
	{#if error}
		<div class="alert alert-error"><span>{error}</span></div>
	{/if}
	<button class="btn btn-primary btn-lg" onclick={startGame} disabled={!canStart || starting}>
		{#if starting}<span class="loading loading-spinner loading-sm"></span>{/if}
		{t('setup.startGame')}
	</button>
</div>

{#if showSeasonPrompt}
	<PromptDialog
		message={t('setup.seasonPrompt')}
		placeholder="2025/26"
		onconfirm={handleSeasonName}
		oncancel={() => (showSeasonPrompt = false)}
	/>
{/if}
