import type {
  ClosureSpec,
  FlightNetworkDataset,
  Objective,
  RecoveryAction,
  RecoveryRecommendation,
  SimulationResult,
} from '../engine/types.js';
import {
  answerGroundedQuestion,
  formatBreachedCrews,
  formatBrokenConnections,
  formatClosureLine,
  formatRecommendationsBlock,
  formatSummaryImpact,
  formatTopDelays,
} from './askFallback.js';

function formatCancelledFlights(activeSim: SimulationResult, limit = 5): string | null {
  const cancelled = activeSim.flights
    .filter((f) => f.cancelled)
    .sort((a, b) => a.flight_id.localeCompare(b.flight_id))
    .slice(0, limit);
  if (cancelled.length === 0) {
    return null;
  }
  const items = cancelled.map((f) => `${f.flight_id} (${f.origin}->${f.destination}, ${f.pax} pax)`);
  return `Cancelled flights: ${items.join('; ')}.`;
}

/**
 * Produce a concise deterministic operational briefing (or grounded Q&A when
 * `question` is supplied) citing only IDs and metrics from `dataset` and the
 * engine simulation outputs.
 */
export function buildDeterministicBriefing(
  dataset: FlightNetworkDataset,
  closure: ClosureSpec | null,
  actions: readonly RecoveryAction[],
  objective: Objective,
  baselineSim: SimulationResult,
  activeSim: SimulationResult,
  recommendations: readonly RecoveryRecommendation[],
  question?: string,
): string {
  const trimmedQuestion = question?.trim();
  if (trimmedQuestion) {
    return answerGroundedQuestion(
      dataset,
      closure,
      actions,
      objective,
      baselineSim,
      activeSim,
      recommendations,
      trimmedQuestion,
    );
  }

  const lines: string[] = [
    formatClosureLine(dataset, closure, activeSim),
    formatSummaryImpact(actions, baselineSim, activeSim),
  ];

  const breached = formatBreachedCrews(activeSim);
  if (breached) lines.push(breached);

  const broken = formatBrokenConnections(activeSim, 3);
  if (broken) lines.push(broken);

  const cancelled = formatCancelledFlights(activeSim, 5);
  if (cancelled) lines.push(cancelled);

  const delays = formatTopDelays(activeSim, 3);
  if (delays) lines.push(delays);

  if (
    activeSim.summary.lateFlights === 0 &&
    activeSim.summary.crewBreaches === 0 &&
    activeSim.summary.brokenConnections === 0 &&
    activeSim.summary.cancelledFlights === 0
  ) {
    lines.push('All scheduled flights, connections, and crew duty limits are nominal.');
  } else {
    lines.push(formatRecommendationsBlock(objective, recommendations, 2));
  }

  return lines.join('\n');
}
