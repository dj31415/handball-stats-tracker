<script lang="ts">
	import type { Player, PlayerGameStats } from '@shared/types';
	import { isGoaliePosition } from '@shared/types';
	import { t } from '$lib/i18n/index.svelte';

	let { player, stats, onclick, flashClass = '' }: { player: Player; stats: PlayerGameStats; onclick: () => void; flashClass?: string } = $props();

	const isGoalie = $derived(isGoaliePosition(player.position));
</script>

<button
	class="btn btn-outline h-full max-h-24 py-1 px-3 flex flex-col gap-0 justify-center min-w-0 w-full transition-colors duration-300"
	class:btn-info={isGoalie && !flashClass}
	class:btn-success={flashClass === 'goal'}
	class:btn-error={flashClass === 'miss'}
	class:btn-warning={flashClass === 'card'}
	{onclick}
>
	<span class="text-base font-bold">
		#{player.number}
		{#if isGoalie}<span class="text-xs font-normal">{t('playerTile.gk')}</span>{/if}
	</span>
	<span class="text-xs truncate w-full text-center">{player.name}</span>
	{#if isGoalie}
		<span class="text-xs opacity-70 mt-1">
			{t('table.sv')}:{stats.saves + stats.saves_7m} {t('table.con')}:{stats.conceded + stats.conceded_7m}
		</span>
	{:else}
		<span class="text-xs opacity-70 mt-1">
			{t('table.g')}:{stats.goals + stats.goals_7m} {t('table.m')}:{stats.misses + stats.misses_7m}
		</span>
	{/if}
</button>
