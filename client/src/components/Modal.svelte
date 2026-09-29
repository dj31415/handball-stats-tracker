<script lang="ts">
	import type { Snippet } from 'svelte';
	import { trapFocus } from '$lib/focusTrap';

	let {
		title,
		onclose,
		children,
		actions
	}: {
		title: string;
		onclose: () => void;
		children: Snippet;
		actions?: Snippet;
	} = $props();

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
	}

	function handleBackdrop(e: MouseEvent) {
		if (e.target === e.currentTarget) onclose();
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
	role="dialog"
	aria-modal="true"
	aria-labelledby="modal-title"
	tabindex="-1"
	onkeydown={handleKeydown}
	onclick={handleBackdrop}
	use:trapFocus
>
	<div class="card bg-base-200 shadow-2xl w-full max-w-sm">
		<div class="card-body">
			<h3 id="modal-title" class="card-title">{title}</h3>
			{@render children()}
			{#if actions}
				<div class="card-actions justify-end mt-4">
					{@render actions()}
				</div>
			{/if}
		</div>
	</div>
</div>
