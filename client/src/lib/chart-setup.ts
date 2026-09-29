import {
	Chart,
	LineController,
	BarController,
	DoughnutController,
	PolarAreaController,
	CategoryScale,
	LinearScale,
	RadialLinearScale,
	PointElement,
	LineElement,
	BarElement,
	ArcElement,
	Tooltip,
	Legend,
	Filler
} from 'chart.js';

Chart.register(
	LineController,
	BarController,
	DoughnutController,
	PolarAreaController,
	CategoryScale,
	LinearScale,
	RadialLinearScale,
	PointElement,
	LineElement,
	BarElement,
	ArcElement,
	Tooltip,
	Legend,
	Filler
);

export { Chart };

export interface ChartColors {
	primary: string;
	error: string;
	success: string;
	warning: string;
	neutral: string;
	baseContent: string;
	base200: string;
}

/** Reusable 1x1 canvas for color conversion */
let colorCanvas: HTMLCanvasElement | null = null;
let colorCtx: CanvasRenderingContext2D | null = null;

/** Convert any CSS color (including oklch) to hex via canvas 2D fillStyle resolution */
function cssColorToHex(cssColor: string): string {
	if (!colorCanvas) {
		colorCanvas = document.createElement('canvas');
		colorCanvas.width = colorCanvas.height = 1;
		colorCtx = colorCanvas.getContext('2d');
	}
	if (!colorCtx) return '#888888';
	colorCtx.clearRect(0, 0, 1, 1);
	colorCtx.fillStyle = cssColor;
	colorCtx.fillRect(0, 0, 1, 1);
	const [r, g, b] = colorCtx.getImageData(0, 0, 1, 1).data;
	return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
}

/** Create an rgba string from a hex color and alpha value (0-1) */
export function hexAlpha(hex: string, alpha: number): string {
	const r = parseInt(hex.slice(1, 3), 16);
	const g = parseInt(hex.slice(3, 5), 16);
	const b = parseInt(hex.slice(5, 7), 16);
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

let cachedColors: ChartColors | null = null;
let cachedTheme: string | null = null;

export function getChartColors(): ChartColors {
	const currentTheme = document.documentElement.getAttribute('data-theme');
	if (cachedColors && cachedTheme === currentTheme) return cachedColors;
	cachedTheme = currentTheme;
	const style = getComputedStyle(document.documentElement);
	const resolve = (prop: string, fallback: string) => {
		const val = style.getPropertyValue(prop).trim();
		if (!val) return fallback;
		return cssColorToHex(val);
	};
	cachedColors = {
		primary: resolve('--color-primary', '#6419e6'),
		error: resolve('--color-error', '#ff6f6f'),
		success: resolve('--color-success', '#36d399'),
		warning: resolve('--color-warning', '#fbbd23'),
		neutral: resolve('--color-neutral', '#2a323c'),
		baseContent: resolve('--color-base-content', '#a6adba'),
		base200: resolve('--color-base-200', '#242933'),
	};
	return cachedColors;
}

export const ZONE_COLORS = [
	'#2563eb', // LW - blue
	'#f59e0b', // PV - amber
	'#10b981', // RW - emerald
	'#ef4444', // LB - red
	'#06b6d4', // CB - cyan
	'#8b5cf6', // RB - violet
];

/** Tooltip config for charts that don't use getSharedOptions (doughnuts, polar) */
export function getTooltipStyle(colors: ChartColors) {
	return {
		backgroundColor: hexAlpha(colors.base200, 0.95),
		titleColor: colors.baseContent,
		bodyColor: hexAlpha(colors.baseContent, 0.85),
		borderColor: hexAlpha(colors.baseContent, 0.15),
		borderWidth: 1
	};
}

/** Legend label config reusable across all chart types */
export function getLegendLabelStyle(colors: ChartColors) {
	return { color: hexAlpha(colors.baseContent, 0.85), font: { size: 11 } };
}

export function getSharedOptions(colors: ChartColors) {
	const tickColor = hexAlpha(colors.baseContent, 0.7);
	const gridColor = hexAlpha(colors.baseContent, 0.12);

	return {
		responsive: true,
		maintainAspectRatio: false,
		plugins: {
			legend: {
				labels: getLegendLabelStyle(colors)
			},
			tooltip: {
				mode: 'nearest' as const,
				intersect: false,
				...getTooltipStyle(colors)
			}
		},
		scales: {
			x: {
				ticks: { color: tickColor },
				grid: { color: gridColor }
			},
			y: {
				ticks: { color: tickColor },
				grid: { color: gridColor }
			}
		}
	};
}
