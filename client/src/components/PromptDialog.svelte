<script lang="ts">
	import Modal from './Modal.svelte';
	import { t } from '$lib/i18n/index.svelte';

	let {
		title = '',
		message,
		placeholder = '',
		onconfirm,
		oncancel
	}: {
		title?: string;
		message: string;
		placeholder?: string;
		onconfirm: (value: string) => void;
		oncancel: () => void;
	} = $props();

	let value = $state('');

	function handleSubmit() {
		if (value.trim()) onconfirm(value.trim());
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && value.trim()) {
			e.stopPropagation();
			handleSubmit();
		}
	}
</script>

<Modal title={title || message} onclose={oncancel}>
	{#snippet children()}
		{#if title}
			<p>{message}</p>
		{/if}
		<input
			type="text"
			class="input input-bordered w-full mt-2"
			bind:value
			{placeholder}
			onkeydown={handleKeydown}
		/>
	{/snippet}
	{#snippet actions()}
		<button class="btn btn-ghost" onclick={oncancel}>{t('action.cancel')}</button>
		<button class="btn btn-primary" onclick={handleSubmit} disabled={!value.trim()}>{t('common.confirm')}</button>
	{/snippet}
</Modal>
