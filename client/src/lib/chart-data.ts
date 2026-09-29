import type { ChartData, ChartOptions } from 'chart.js';
import type { GameEvent, Player, Game, ShotZone, PlayerGameStats } from '@shared/types';
import { SHOT_ZONES, teamScore, opponentScore } from '@shared/types';
import type { ChartColors } from './chart-setup';
import { formatDateShort } from '$lib/format';
import { getSharedOptions, getTooltipStyle, getLegendLabelStyle, hexAlpha, ZONE_COLORS } from './chart-setup';

// ── Score Progression (Line) ──

export function buildScoreProgressionData(
	events: GameEvent[],
	teamLabel: string,
	oppLabel: string,
	colors: ChartColors
): { data: ChartData<'line'>; options: ChartOptions<'line'> } {
	const scoringEvents = events.filter(
		(e) =>
			e.event_type === 'goal' ||
			e.event_type === 'goal_7m' ||
			e.event_type === 'opponent_goal' ||
			e.event_type === 'opponent_7m'
	);

	const labels: string[] = ['0'];
	const teamScores: number[] = [0];
	const oppScores: number[] = [0];
	let team = 0;
	let opp = 0;

	for (let i = 0; i < scoringEvents.length; i++) {
		const e = scoringEvents[i];
		if (e.event_type === 'goal' || e.event_type === 'goal_7m') team++;
		else opp++;
		labels.push(String(i + 1));
		teamScores.push(team);
		oppScores.push(opp);
	}

	const shared = getSharedOptions(colors);

	return {
		data: {
			labels,
			datasets: [
				{
					label: teamLabel,
					data: teamScores,
					borderColor: colors.primary,
					backgroundColor: hexAlpha(colors.primary, 0.2),
					tension: 0.2,
					pointRadius: 3,
					fill: false
				},
				{
					label: oppLabel,
					data: oppScores,
					borderColor: colors.error,
					backgroundColor: hexAlpha(colors.error, 0.2),
					tension: 0.2,
					pointRadius: 3,
					fill: false
				}
			]
		},
		options: {
			...shared,
			scales: {
				x: {
					display: false
				},
				y: {
					beginAtZero: true,
					ticks: {
						stepSize: 1,
						color: hexAlpha(colors.baseContent, 0.7)
					},
					grid: { color: hexAlpha(colors.baseContent, 0.12) }
				}
			},
			plugins: {
				...shared.plugins,
				legend: {
					...shared.plugins!.legend,
					position: 'bottom'
				}
			}
		}
	};
}

// ── Shot Zone Polar Area ──

export function buildShotZonePolarData(
	zoneStats: Record<ShotZone, { goals: number; misses: number }>,
	zoneLabels: string[],
	colors: ChartColors
): { data: ChartData<'polarArea'>; options: ChartOptions<'polarArea'> } {
	const values = SHOT_ZONES.map((z) => {
		const s = zoneStats[z];
		const total = s.goals + s.misses;
		return total > 0 ? Math.round((s.goals / total) * 100) : 0;
	});

	return {
		data: {
			labels: zoneLabels,
			datasets: [
				{
					data: values,
					backgroundColor: ZONE_COLORS.map((c) => hexAlpha(c, 0.6)),
					borderColor: ZONE_COLORS,
					borderWidth: 1
				}
			]
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			scales: {
				r: {
					beginAtZero: true,
					max: 100,
					ticks: {
						stepSize: 25,
						color: hexAlpha(colors.baseContent, 0.7),
						backdropColor: 'transparent'
					},
					grid: { color: hexAlpha(colors.baseContent, 0.12) },
					angleLines: { color: hexAlpha(colors.baseContent, 0.12) },
					pointLabels: { color: hexAlpha(colors.baseContent, 0.85) }
				}
			},
			plugins: {
				legend: {
					position: 'bottom',
					labels: getLegendLabelStyle(colors)
				},
				tooltip: {
					...getTooltipStyle(colors),
					callbacks: {
						label: (ctx) => {
							const z = SHOT_ZONES[ctx.dataIndex];
							const s = zoneStats[z];
							const total = s.goals + s.misses;
							return `${ctx.formattedValue}% (${s.goals}/${total})`;
						}
					}
				}
			}
		}
	};
}

// ── Goal Contribution (Doughnut) ──

export function buildGoalContributionData(
	events: GameEvent[],
	players: Player[],
	colors: ChartColors
): { data: ChartData<'doughnut'>; options: ChartOptions<'doughnut'> } | null {
	const goalsByPlayer = new Map<string, number>();
	for (const e of events) {
		if (!e.player_id) continue;
		if (e.event_type === 'goal' || e.event_type === 'goal_7m') {
			goalsByPlayer.set(e.player_id, (goalsByPlayer.get(e.player_id) || 0) + 1);
		}
	}

	const scorers = players
		.map((p) => ({ player: p, goals: goalsByPlayer.get(p.id) || 0 }))
		.filter((s) => s.goals > 0)
		.sort((a, b) => b.goals - a.goals);

	if (scorers.length === 0) return null;

	const palette = [
		colors.primary,
		colors.success,
		colors.warning,
		colors.error,
		'#6366f1',
		'#ec4899',
		'#14b8a6',
		'#f97316',
		'#8b5cf6',
		'#06b6d4'
	];

	return {
		data: {
			labels: scorers.map((s) => `#${s.player.number} ${s.player.name}`),
			datasets: [
				{
					data: scorers.map((s) => s.goals),
					backgroundColor: scorers.map((_, i) => hexAlpha(palette[i % palette.length], 0.8)),
					borderColor: scorers.map((_, i) => palette[i % palette.length]),
					borderWidth: 1
				}
			]
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			cutout: '40%',
			plugins: {
				legend: {
					position: 'bottom',
					labels: getLegendLabelStyle(colors)
				},
				tooltip: {
					...getTooltipStyle(colors),
					callbacks: {
						label: (ctx) => {
							const total = (ctx.dataset.data as number[]).reduce((a, b) => a + b, 0);
							const pct = Math.round(((ctx.raw as number) / total) * 100);
							return `${ctx.label}: ${ctx.raw} (${pct}%)`;
						}
					}
				}
			}
		}
	};
}

// ── Half Comparison (Bar) ──

export function buildHalfComparisonData(
	events: GameEvent[],
	labels: { goals: string; misses: string; oppGoals: string; saves: string; h1: string; h2: string },
	colors: ChartColors
): { data: ChartData<'bar'>; options: ChartOptions<'bar'> } | null {
	const h1 = events.filter((e) => e.half === 1);
	const h2 = events.filter((e) => e.half === 2);
	if (h1.length === 0 || h2.length === 0) return null;

	function count(evs: GameEvent[], types: string[]) {
		return evs.filter((e) => types.includes(e.event_type)).length;
	}

	const categories = [labels.goals, labels.misses, labels.oppGoals, labels.saves];
	const types = [
		['goal', 'goal_7m'],
		['miss', 'miss_7m'],
		['opponent_goal', 'opponent_7m'],
		['save', 'save_7m']
	];

	const shared = getSharedOptions(colors);

	return {
		data: {
			labels: categories,
			datasets: [
				{
					label: labels.h1,
					data: types.map((t) => count(h1, t)),
					backgroundColor: hexAlpha(colors.primary, 0.8),
					borderColor: colors.primary,
					borderWidth: 1
				},
				{
					label: labels.h2,
					data: types.map((t) => count(h2, t)),
					backgroundColor: hexAlpha(colors.success, 0.8),
					borderColor: colors.success,
					borderWidth: 1
				}
			]
		},
		options: {
			...shared,
			indexAxis: 'y',
			plugins: {
				...shared.plugins,
				legend: {
					...shared.plugins!.legend,
					position: 'bottom'
				}
			}
		}
	};
}

// ── Win/Draw/Loss Doughnut ──

export function buildWinDrawLossData(
	record: { wins: number; draws: number; losses: number },
	labels: { wins: string; draws: string; losses: string },
	colors: ChartColors
): { data: ChartData<'doughnut'>; options: ChartOptions<'doughnut'> } {
	return {
		data: {
			labels: [labels.wins, labels.draws, labels.losses],
			datasets: [
				{
					data: [record.wins, record.draws, record.losses],
					backgroundColor: [
						hexAlpha(colors.success, 0.8),
						hexAlpha(colors.warning, 0.8),
						hexAlpha(colors.error, 0.8)
					],
					borderColor: [colors.success, colors.warning, colors.error],
					borderWidth: 1
				}
			]
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			cutout: '40%',
			plugins: {
				legend: {
					position: 'bottom',
					labels: getLegendLabelStyle(colors)
				},
				tooltip: getTooltipStyle(colors)
			}
		}
	};
}

// ── Goal Differential (Bar) ──

export function buildGoalDifferentialData(
	finishedGames: Game[],
	allEvents: Map<string, GameEvent[]>,
	colors: ChartColors,
	diffLabel: string
): { data: ChartData<'bar'>; options: ChartOptions<'bar'> } {
	const sorted = [...finishedGames].sort((a, b) => a.date.localeCompare(b.date));

	const labels = sorted.map((g) => `${g.opponent} (${formatDateShort(g.date)})`);
	const diffs = sorted.map((g) => {
		const ev = allEvents.get(g.id) || [];
		return teamScore(ev) - opponentScore(ev);
	});
	const bgColors = diffs.map((d) => (d >= 0 ? hexAlpha(colors.success, 0.8) : hexAlpha(colors.error, 0.8)));
	const borderColors = diffs.map((d) => (d >= 0 ? colors.success : colors.error));

	const shared = getSharedOptions(colors);

	return {
		data: {
			labels,
			datasets: [
				{
					label: diffLabel,
					data: diffs,
					backgroundColor: bgColors,
					borderColor: borderColors,
					borderWidth: 1
				}
			]
		},
		options: {
			...shared,
			scales: {
				x: {
					ticks: { color: hexAlpha(colors.baseContent, 0.7), maxRotation: 45 },
					grid: { color: hexAlpha(colors.baseContent, 0.12) }
				},
				y: {
					beginAtZero: false,
					ticks: { stepSize: 1, color: hexAlpha(colors.baseContent, 0.7) },
					grid: { color: hexAlpha(colors.baseContent, 0.12) }
				}
			},
			plugins: {
				...shared.plugins,
				legend: { display: false }
			}
		}
	};
}

// ── Top Scorers (Horizontal Bar) ──

export function buildTopScorersData(
	players: Player[],
	aggregatedStats: Map<string, PlayerGameStats & { gamesPlayed: number }>,
	colors: ChartColors,
	limit = 8
): { data: ChartData<'bar'>; options: ChartOptions<'bar'> } {
	const scorers = players
		.map((p) => {
			const s = aggregatedStats.get(p.id);
			return { player: p, goals: s ? s.goals + s.goals_7m : 0 };
		})
		.filter((s) => s.goals > 0)
		.sort((a, b) => b.goals - a.goals)
		.slice(0, limit);

	const shared = getSharedOptions(colors);

	return {
		data: {
			labels: scorers.map((s) => `#${s.player.number} ${s.player.name}`),
			datasets: [
				{
					data: scorers.map((s) => s.goals),
					backgroundColor: scorers.map((_, i) => hexAlpha(colors.primary, 0.9 - i * 0.08)),
					borderColor: colors.primary,
					borderWidth: 1
				}
			]
		},
		options: {
			...shared,
			indexAxis: 'y',
			scales: {
				x: {
					beginAtZero: true,
					ticks: { stepSize: 1, color: hexAlpha(colors.baseContent, 0.7) },
					grid: { color: hexAlpha(colors.baseContent, 0.12) }
				},
				y: {
					ticks: { color: hexAlpha(colors.baseContent, 0.7) },
					grid: { display: false }
				}
			},
			plugins: {
				...shared.plugins,
				legend: { display: false }
			}
		}
	};
}

// ── Efficiency Trend (Line) ──

export function buildEfficiencyTrendData(
	finishedGames: Game[],
	allEvents: Map<string, GameEvent[]>,
	colors: ChartColors,
	rateLabel: string
): { data: ChartData<'line'>; options: ChartOptions<'line'> } {
	const sorted = [...finishedGames].sort((a, b) => a.date.localeCompare(b.date));

	const labels = sorted.map((g) => `${g.opponent} (${formatDateShort(g.date)})`);
	const rates = sorted.map((g) => {
		const ev = allEvents.get(g.id) || [];
		let goals = 0, total = 0;
		for (const e of ev) {
			if (e.event_type === 'goal' || e.event_type === 'goal_7m') { goals++; total++; }
			else if (e.event_type === 'miss' || e.event_type === 'miss_7m') { total++; }
		}
		return total > 0 ? Math.round((goals / total) * 100) : 0;
	});

	const shared = getSharedOptions(colors);

	return {
		data: {
			labels,
			datasets: [
				{
					label: rateLabel,
					data: rates,
					borderColor: colors.primary,
					backgroundColor: hexAlpha(colors.primary, 0.15),
					tension: 0.3,
					pointRadius: 4,
					pointBackgroundColor: colors.primary,
					fill: true
				}
			]
		},
		options: {
			...shared,
			scales: {
				x: {
					ticks: { color: hexAlpha(colors.baseContent, 0.7), maxRotation: 45 },
					grid: { color: hexAlpha(colors.baseContent, 0.12) }
				},
				y: {
					beginAtZero: true,
					max: 100,
					ticks: {
						stepSize: 25,
						color: hexAlpha(colors.baseContent, 0.7),
						callback: (val: string | number) => val + '%'
					},
					grid: { color: hexAlpha(colors.baseContent, 0.12) }
				}
			},
			plugins: {
				...shared.plugins,
				legend: { display: false },
				tooltip: {
					...shared.plugins!.tooltip,
					callbacks: {
						label: (ctx) => `${ctx.formattedValue}%`
					}
				}
			}
		}
	};
}
