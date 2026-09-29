<script lang="ts">
	import type { Player, EventType, ShotZone } from '@shared/types';
	import { SHOT_ZONES, isGoaliePosition } from '@shared/types';
	import { t } from '$lib/i18n/index.svelte';
	import { trapFocus } from '$lib/focusTrap';

	let {
		player,
		onaction,
		onclose
	}: {
		player: Player;
		onaction: (eventType: EventType, shotZone: ShotZone | null) => void;
		onclose: () => void;
	} = $props();

	const isGoalie = $derived(isGoaliePosition(player.position));

	function act(type: EventType, zone: ShotZone | null = null) {
		onaction(type, zone);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
	}
</script>

<div
	class="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
	role="dialog"
	aria-modal="true"
	aria-labelledby="action-overlay-title"
	tabindex="-1"
	use:trapFocus
	onkeydown={handleKeydown}
	onpointerdown={(e: PointerEvent) => { if (e.target === e.currentTarget) onclose(); }}
>
	<div class="card bg-base-200 w-full max-w-md shadow-2xl">
		<div class="card-body gap-4">
			<h3 id="action-overlay-title" class="card-title text-center justify-center">
				#{player.number} {player.name}
			</h3>

			{#if isGoalie}
				<div class="grid grid-cols-2 gap-3">
					<button class="btn btn-success btn-lg" onclick={() => act('save')}>{t('action.save')}</button>
					<button class="btn btn-error btn-lg" onclick={() => act('conceded')}>{t('action.conceded')}</button>
					<button class="btn btn-success btn-outline btn-lg" onclick={() => act('save_7m')}>{t('action.save7m')}</button>
					<button class="btn btn-error btn-outline btn-lg" onclick={() => act('conceded_7m')}>{t('action.conceded7m')}</button>
				</div>
			{:else}
				<div>
					<div class="text-sm font-semibold text-success mb-2">{t('action.goalFrom')}</div>
					<div class="grid grid-cols-3 gap-2">
						{#each SHOT_ZONES as zone}
							<button class="btn btn-success btn-md" onclick={() => act('goal', zone)}>
								{t(`zone.${zone}`)}
							</button>
						{/each}
					</div>
				</div>

				<div>
					<div class="text-sm font-semibold text-error mb-2">{t('action.missFrom')}</div>
					<div class="grid grid-cols-3 gap-2">
						{#each SHOT_ZONES as zone}
							<button class="btn btn-error btn-md" onclick={() => act('miss', zone)}>
								{t(`zone.${zone}`)}
							</button>
						{/each}
					</div>
				</div>

				<div class="grid grid-cols-2 gap-2">
					<button class="btn btn-success btn-outline" onclick={() => act('goal_7m')}>{t('action.goal7m')}</button>
					<button class="btn btn-error btn-outline" onclick={() => act('miss_7m')}>{t('action.miss7m')}</button>
				</div>
			{/if}

			<!-- Common actions -->
			<div class="divider my-0"></div>
			<div class="grid grid-cols-2 gap-2">
				<button class="btn btn-warning btn-md" onclick={() => act('tech_mistake')}>{t('action.techMistake')}</button>
				<button class="btn btn-md btn-outline" onclick={() => act('yellow_card')}>
					<span class="inline-block w-3 h-4 bg-yellow-400 rounded-sm"></span> {t('action.yellow')}
				</button>
				<button class="btn btn-warning btn-outline btn-md" onclick={() => act('suspension_2min')}>{t('action.twoMin')}</button>
				<button class="btn btn-md btn-outline" onclick={() => act('red_card')}>
					<span class="inline-block w-3 h-4 bg-red-500 rounded-sm"></span> {t('action.red')}
				</button>
			</div>

			<button class="btn btn-ghost" onclick={onclose}>{t('action.cancel')}</button>
		</div>
	</div>
</div>
