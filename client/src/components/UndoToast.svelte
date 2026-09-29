<script lang="ts">
	import { onMount } from 'svelte';

	let { message, ondismiss }: {
		message: string;
		ondismiss: () => void;
	} = $props();

	onMount(() => {
		const timer = setTimeout(ondismiss, 3000);
		return () => clearTimeout(timer);
	});
</script>

<div class="fixed inset-x-0 bottom-24 mx-auto z-50 alert shadow-lg max-w-sm w-fit">
	<span class="text-sm">{message}</span>
</div>
