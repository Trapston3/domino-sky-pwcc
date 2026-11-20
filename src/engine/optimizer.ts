import { diffSimulations, formatActionLabel } from './diff.js';
import { simulateNetwork } from './simulator.js';
import type {
  ClosureSpec, FlightNetworkDataset, Objective, RecommendationDiff,
  RecoveryAction, RecoveryRecommendation, SimulationResult, SimulationSummary,
} from './types.js';

export { formatActionLabel } from './diff.js';

interface Candidate {
  id: string;
  addedActions: RecoveryAction[];
  actionLabels: string[];
  sim: SimulationResult;
  diff: RecommendationDiff;
}

const MAX_PAIR_SEEDS_PER_OBJECTIVE = 6;
const MAX_RECOMMENDATIONS = 8;

const OBJECTIVE_KEYS: Record<Objective, ReadonlyArray<keyof SimulationSummary>> = {
  compliance: ['crewBreaches', 'strandedPax', 'totalDelayMin', 'totalCrewOverageMin'],
  passengers: ['strandedPax', 'crewBreaches', 'totalDelayMin'],
  delay: ['totalDelayMin', 'crewBreaches', 'strandedPax'],
};

function actionKey(action: RecoveryAction): string {
  switch (action.type) {
    case 'SWAP_SPARE': return `SWAP_SPARE:${action.spareTail}:${action.flightId}`;
    case 'CANCEL_TAIL_END': return `CANCEL_TAIL_END:${action.tailId}:${action.count}`;
    case 'CANCEL_LOOP': return `CANCEL_LOOP:${action.firstFlightId}:${action.lastFlightId}`;
    case 'HOLD_CONNECTION': return `HOLD_CONNECTION:${action.connectionId}`;
  }
}

function canonicalPlanKey(actions: readonly RecoveryAction[]): string {
  return actions.map(actionKey).sort().join('|');
}

function improvesSummary(ref: SimulationSummary, cand: SimulationSummary): boolean {
  return (
    cand.crewBreaches < ref.crewBreaches ||
    cand.strandedPax < ref.strandedPax ||
    cand.totalDelayMin < ref.totalDelayMin ||
    cand.brokenConnections < ref.brokenConnections ||
    cand.lateFlights < ref.lateFlights ||
    cand.totalCrewOverageMin < ref.totalCrewOverageMin
  );
}

function compareCandidates(a: Candidate, b: Candidate, objective: Objective): number {
  const sa = a.sim.summary;
  const sb = b.sim.summary;
  for (const key of OBJECTIVE_KEYS[objective]) {
    const diff = sa[key] - sb[key];
    if (diff !== 0) return diff;
  }
  if (sa.lateFlights !== sb.lateFlights) return sa.lateFlights - sb.lateFlights;
  if (a.addedActions.length !== b.addedActions.length) {
    return a.addedActions.length - b.addedActions.length;
  }
  return a.id.localeCompare(b.id);
}

function generateSingleActions(dataset: FlightNetworkDataset, baseSim: SimulationResult): RecoveryAction[] {
  const actions: RecoveryAction[] = [];
  for (const spare of dataset.spare_aircraft) {
    for (const f of baseSim.flights) {
      if (!f.cancelled && f.origin === spare.base) {
        actions.push({ type: 'SWAP_SPARE', spareTail: spare.tail_id, flightId: f.flight_id });
      }
    }
  }

  const activeByTail = new Map<string, typeof baseSim.flights>();
  for (const f of baseSim.flights) {
    if (f.cancelled) continue;
    const list = activeByTail.get(f.operatingTail) ?? [];
    list.push(f);
    activeByTail.set(f.operatingTail, list);
  }

  for (const [tailId, flights] of [...activeByTail.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const chain = flights.slice().sort((a, b) => a.leg_order - b.leg_order);
    for (let count = 1; count <= chain.length; count += 1) {
      actions.push({ type: 'CANCEL_TAIL_END', tailId, count });
    }
    for (let i = 0; i < chain.length; i += 1) {
      for (let j = i; j < chain.length; j += 1) {
        if (chain[i].origin === chain[j].destination) {
          actions.push({ type: 'CANCEL_LOOP', firstFlightId: chain[i].flight_id, lastFlightId: chain[j].flight_id });
        }
      }
    }
  }

  for (const conn of baseSim.connections) {
    if (conn.status === 'broken') {
      actions.push({ type: 'HOLD_CONNECTION', connectionId: conn.connection_id });
    }
  }
  return actions;
}

function actionsObviouslyConflict(a: RecoveryAction, b: RecoveryAction): boolean {
  if (actionKey(a) === actionKey(b)) return true;
  if (a.type !== b.type) return false;
  if (a.type === 'SWAP_SPARE' && b.type === 'SWAP_SPARE') return a.spareTail === b.spareTail;
  if (a.type === 'CANCEL_TAIL_END' && b.type === 'CANCEL_TAIL_END') return a.tailId === b.tailId;
  if (a.type === 'HOLD_CONNECTION' && b.type === 'HOLD_CONNECTION') return a.connectionId === b.connectionId;
  return false;
}

function expandBreachPairs(
  dataset: FlightNetworkDataset,
  closure: ClosureSpec | null,
  baseActions: readonly RecoveryAction[],
  baseSim: SimulationResult,
  singleCandidates: readonly Candidate[],
  seenPlans: Set<string>,
  allCandidates: Candidate[]
): void {
  const seedMap = new Map<string, Candidate>();
  for (const obj of ['compliance', 'passengers', 'delay'] as const) {
    const top = singleCandidates.slice().sort((a, b) => compareCandidates(a, b, obj));
    for (const cand of top.slice(0, MAX_PAIR_SEEDS_PER_OBJECTIVE)) seedMap.set(cand.id, cand);
  }
  const seeds = [...seedMap.values()];

  const tryAddPair = (first: Candidate, second: RecoveryAction, secondBaseline?: SimulationSummary) => {
    if (actionsObviouslyConflict(first.addedActions[0], second)) return;
    const pair = [first.addedActions[0], second];
    const planKey = canonicalPlanKey(pair);
    if (seenPlans.has(planKey)) return;

    const sim = simulateNetwork(dataset, closure, [...baseActions, ...pair]);
    if (!sim.ok || !improvesSummary(first.sim.summary, sim.summary)) return;
    if (secondBaseline && !improvesSummary(secondBaseline, sim.summary)) return;

    seenPlans.add(planKey);
    allCandidates.push({
      id: pair.map(actionKey).join('__'),
      addedActions: pair,
      actionLabels: pair.map(formatActionLabel),
      sim,
      diff: diffSimulations(baseSim, sim),
    });
  };

  for (const cand of singleCandidates) {
    if (cand.sim.summary.crewBreaches >= baseSim.summary.crewBreaches) continue;
    for (const conn of cand.sim.connections) {
      if (conn.status !== 'broken') continue;
      const holdSingle = singleCandidates.find(
        (s) => s.addedActions[0].type === 'HOLD_CONNECTION' && s.addedActions[0].connectionId === conn.connection_id
      );
      tryAddPair(cand, { type: 'HOLD_CONNECTION', connectionId: conn.connection_id }, holdSingle?.sim.summary);
    }
  }

  const isCancel = (a: RecoveryAction) => a.type === 'CANCEL_TAIL_END' || a.type === 'CANCEL_LOOP';
  for (let i = 0; i < seeds.length; i += 1) {
    for (let j = i + 1; j < seeds.length; j += 1) {
      const [a, b] = [seeds[i], seeds[j]];
      const cleared = a.sim.summary.crewBreaches === 0 || b.sim.summary.crewBreaches === 0;
      if (cleared && isCancel(a.addedActions[0]) && isCancel(b.addedActions[0])) continue;
      tryAddPair(a, b.addedActions[0], b.sim.summary);
    }
  }
}

function evaluateCandidatePool(
  dataset: FlightNetworkDataset,
  closure: ClosureSpec | null,
  baseActions: readonly RecoveryAction[]
): Candidate[] {
  const baseSim = simulateNetwork(dataset, closure, baseActions);
  if (!baseSim.ok) return [];
  const { lateFlights, brokenConnections, crewBreaches } = baseSim.summary;
  if (lateFlights === 0 && brokenConnections === 0 && crewBreaches === 0) return [];

  const seenPlans = new Set<string>();
  const singleCandidates: Candidate[] = [];
  for (const action of generateSingleActions(dataset, baseSim)) {
    const planKey = canonicalPlanKey([action]);
    if (seenPlans.has(planKey)) continue;
    const sim = simulateNetwork(dataset, closure, [...baseActions, action]);
    if (!sim.ok || !improvesSummary(baseSim.summary, sim.summary)) continue;

    seenPlans.add(planKey);
    singleCandidates.push({
      id: actionKey(action),
      addedActions: [action],
      actionLabels: [formatActionLabel(action)],
      sim,
      diff: diffSimulations(baseSim, sim),
    });
  }

  const allCandidates: Candidate[] = [...singleCandidates];
  if (crewBreaches > 0 && singleCandidates.length > 0) {
    expandBreachPairs(dataset, closure, baseActions, baseSim, singleCandidates, seenPlans, allCandidates);
  }
  return allCandidates;
}

function rankCandidates(candidates: readonly Candidate[], objective: Objective): RecoveryRecommendation[] {
  return candidates
    .slice()
    .sort((a, b) => compareCandidates(a, b, objective))
    .slice(0, MAX_RECOMMENDATIONS)
    .map((cand) => ({
      id: cand.id,
      title: cand.actionLabels.join(' + '),
      actions: [...cand.addedActions],
      actionLabels: [...cand.actionLabels],
      objective,
      summary: cand.sim.summary,
      diff: cand.diff,
      sideEffects: cand.diff.sideEffects,
    }));
}

/**
 * Simulates valid recovery actions and returns ranked recommendations for the chosen objective.
 */
export function optimizeRecovery(
  dataset: FlightNetworkDataset,
  closure: ClosureSpec | null,
  objective: Objective,
  baseActions: readonly RecoveryAction[] = []
): RecoveryRecommendation[] {
  return rankCandidates(evaluateCandidatePool(dataset, closure, baseActions), objective);
}

/**
 * Evaluates and ranks recovery recommendations across all three objectives.
 */
export function compareObjectives(
  dataset: FlightNetworkDataset,
  closure: ClosureSpec | null,
  baseActions: readonly RecoveryAction[] = []
): Record<Objective, RecoveryRecommendation[]> {
  const candidates = evaluateCandidatePool(dataset, closure, baseActions);
  return {
    compliance: rankCandidates(candidates, 'compliance'),
    passengers: rankCandidates(candidates, 'passengers'),
    delay: rankCandidates(candidates, 'delay'),
  };
}
