<script lang="ts">
	import { onDestroy } from 'svelte';
	import { Chart } from '$lib/chart-setup';
	import type { ChartData, ChartOptions, ChartType } from 'chart.js';

	let {
		type,
		data,
		options,
		height = '16rem'
	}: {
		type: ChartType;
		data: ChartData;
		options: ChartOptions;
		height?: string;
	} = $props();

	let canvas: HTMLCanvasElement | undefined = $state();
	let chart: Chart | undefined;

	$effect(() => {
		if (!canvas) return;

		const currentData = $state.snapshot(data) as ChartData;
		const currentOptions = $state.snapshot(options) as ChartOptions;

		if (chart) {
			chart.data = currentData;
			chart.options = currentOptions;
			chart.update('none');
		} else {
			chart = new Chart(canvas, {
				type,
				data: currentData,
				options: currentOptions
			});
		}
	});

	onDestroy(() => {
		chart?.destroy();
		chart = undefined;
	});
</script>

<div class="w-full" style:height={height}>
	<canvas bind:this={canvas}></canvas>
</div>
