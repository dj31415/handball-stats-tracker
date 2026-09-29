<script lang="ts">
	import type { Player } from '@shared/types';
	import { t } from '$lib/i18n/index.svelte';
	import { trapFocus } from '$lib/focusTrap';

	let {
		goalies,
		eventLabel,
		onselect,
		onclose
	}: {
		goalies: Player[];
		eventLabel: string;
		onselect: (goalieId: string) => void;
		onclose: () => void;
	} = $props();

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
	}
</script>

<div
	class="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
	role="dialog"
	aria-modal="true"
	aria-labelledby="goalie-select-title"
	tabindex="-1"
	use:trapFocus
	onkeydown={handleKeydown}
	onpointerdown={(e: PointerEvent) => { if (e.target === e.currentTarget) onclose(); }}
>
	<div class="card bg-base-200 w-full max-w-sm shadow-2xl">
		<div class="card-body gap-4">
			<h3 id="goalie-select-title" class="card-title text-center justify-center">{eventLabel}</h3>
			<p class="text-center text-base-content/60">{t('goalieSelect.question')}</p>
			<div class="flex flex-col gap-2">
				{#each goalies as goalie}
					<button class="btn btn-outline btn-lg" onclick={() => onselect(goalie.id)}>
						#{goalie.number} {goalie.name}
					</button>
				{/each}
			</div>
			<button class="btn btn-ghost" onclick={onclose}>{t('goalieSelect.cancel')}</button>
		</div>
	</div>
</div>
