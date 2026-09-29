<script lang="ts">
	import { newId } from '$lib/id';
	import { onMount } from 'svelte';
	import { api, ApiError } from '$lib/api';
	import { isAdmin, pageTitle } from '$lib/session.svelte';
	import { POSITIONS, type Player, type Position } from '@shared/types';
	import { t } from '$lib/i18n/index.svelte';
	import ConfirmDialog from '$components/ConfirmDialog.svelte';

	let players = $state<Player[]>([]);
	let showForm = $state(false);
	let editingPlayer = $state<Player | null>(null);
	let error = $state('');
	let loadError = $state(false);
	let loading = $state(true);
	let playerToDelete = $state<Player | null>(null);

	// Form fields
	let formName = $state('');
	let formNumber = $state(0);
	let formPosition = $state<Position>('CB');

	async function loadPlayers() {
		loadError = false;
		try {
			players = await api.players.list();
		} catch {
			loadError = true;
		} finally {
			loading = false;
		}
	}

	onMount(loadPlayers);

	function openAdd() {
		editingPlayer = null;
		formName = '';
		formNumber = players.length > 0 ? Math.max(...players.map((p) => p.number)) + 1 : 1;
		formPosition = 'CB';
		showForm = true;
		error = '';
	}

	function openEdit(player: Player) {
		editingPlayer = player;
		formName = player.name;
		formNumber = player.number;
		formPosition = player.position;
		showForm = true;
		error = '';
	}

	async function save() {
		if (!formName.trim()) return;
		error = '';
		try {
			if (editingPlayer) {
				await api.players.update(editingPlayer.id, {
					name: formName.trim(),
					number: formNumber,
					position: formPosition
				});
			} else {
				await api.players.create({
					id: newId(),
					name: formName.trim(),
					number: formNumber,
					position: formPosition
				});
			}
		} catch {
			error = t('roster.serverError');
			return;
		}
		await loadPlayers();
		showForm = false;
	}

	async function toggleActive(player: Player) {
		error = '';
		try {
			await api.players.update(player.id, { is_active: player.is_active ? 0 : 1 });
		} catch {
			error = t('roster.serverError');
			return;
		}
		await loadPlayers();
	}

	function removePlayer(player: Player) {
		playerToDelete = player;
	}

	async function doRemovePlayer() {
		if (!playerToDelete) return;
		const player = playerToDelete;
		playerToDelete = null;
		error = '';
		try {
			await api.players.remove(player.id);
		} catch (e) {
			error = e instanceof ApiError && e.status === 409 ? t('roster.deleteBlocked') : t('roster.serverError');
			return;
		}
		await loadPlayers();
	}
</script>

<svelte:head><title>{pageTitle(t('title.roster'))}</title></svelte:head>

<div class="flex justify-between items-center mb-6">
	<h1 class="text-2xl font-bold">{t('roster.title')}</h1>
	{#if isAdmin()}
		<button class="btn btn-primary" onclick={openAdd}>{t('roster.addPlayer')}</button>
	{/if}
</div>

{#if loadError}
	<div class="alert alert-error mb-4">
		<span>{t('common.loadError')}</span>
		<button class="btn btn-sm" onclick={loadPlayers}>{t('common.retry')}</button>
	</div>
{/if}

{#if error}
	<div class="alert alert-error mb-4"><span>{error}</span></div>
{/if}

{#if showForm && isAdmin()}
	<div class="card bg-base-200 mb-6">
		<div class="card-body">
			<h3 class="card-title">{editingPlayer ? t('roster.editPlayer') : t('roster.addPlayer')}</h3>
			<div class="flex flex-wrap gap-4">
				<div class="form-control w-20">
					<label class="label" for="number"><span class="label-text">{t('roster.number')}</span></label>
					<input
						id="number"
						type="number"
						class="input input-bordered w-full"
						bind:value={formNumber}
						min="1"
						max="99"
					/>
				</div>
				<div class="form-control flex-1 min-w-48">
					<label class="label" for="name"><span class="label-text">{t('roster.name')}</span></label>
					<input
						id="name"
						type="text"
						class="input input-bordered w-full"
						bind:value={formName}
						placeholder={t('roster.namePlaceholder')}
					/>
				</div>
				<div class="form-control w-32">
					<label class="label" for="position"><span class="label-text">{t('roster.position')}</span></label>
					<select id="position" class="select select-bordered w-full" bind:value={formPosition}>
						{#each POSITIONS as pos}
							<option value={pos}>{t(`pos.${pos}`)}</option>
						{/each}
					</select>
				</div>
			</div>
			<div class="card-actions justify-end mt-4">
				<button class="btn btn-ghost" onclick={() => (showForm = false)}>{t('roster.cancel')}</button>
				<button class="btn btn-primary" onclick={save} disabled={!formName.trim()}>{t('roster.save')}</button>
			</div>
		</div>
	</div>
{/if}

{#if loading}
	<div class="text-center py-12"><span class="loading loading-spinner loading-lg"></span></div>
{:else if players.length === 0 && !loadError}
	<div class="text-center text-base-content/60 py-12">
		<p class="text-lg">{t('roster.noPlayers')}</p>
		{#if isAdmin()}<p>{t('roster.noPlayersHint')}</p>{/if}
	</div>
{:else if players.length > 0}
	<div class="overflow-x-auto">
		<table class="table">
			<thead>
				<tr>
					<th class="sticky left-0 bg-base-100 z-10">{t('roster.number')}</th>
					<th class="sticky left-8 bg-base-100 z-10">{t('roster.name')}</th>
					<th>{t('roster.position')}</th>
					<th>{t('roster.status')}</th>
					{#if isAdmin()}<th>{t('roster.actions')}</th>{/if}
				</tr>
			</thead>
			<tbody>
				{#each players as player}
					<tr class:opacity-40={!player.is_active}>
						<td class="font-bold sticky left-0 bg-base-100 z-10">{player.number}</td>
						<td class="sticky left-8 bg-base-100 z-10">{player.name}</td>
						<td><span class="badge badge-outline">{t(`pos.${player.position}`)}</span></td>
						<td>
							<span class="badge" class:badge-success={player.is_active} class:badge-error={!player.is_active}>
								{player.is_active ? t('roster.active') : t('roster.inactive')}
							</span>
						</td>
						{#if isAdmin()}
							<td class="flex gap-2">
								<button class="btn btn-ghost btn-xs" onclick={() => openEdit(player)}>{t('roster.edit')}</button>
								<button class="btn btn-ghost btn-xs" onclick={() => toggleActive(player)}>
									{player.is_active ? t('roster.deactivate') : t('roster.activate')}
								</button>
								<button class="btn btn-ghost btn-xs text-error" onclick={() => removePlayer(player)}>
									{t('roster.delete')}
								</button>
							</td>
						{/if}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

{#if playerToDelete}
	<ConfirmDialog
		message={t('roster.confirmDelete', { name: playerToDelete.name, number: playerToDelete.number })}
		onconfirm={doRemovePlayer}
		oncancel={() => (playerToDelete = null)}
	/>
{/if}
