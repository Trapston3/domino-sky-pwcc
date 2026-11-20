import { simulateNetwork } from './simulator.js';
import type {
  ClosureSpec,
  FlightNetworkDataset,
  Objective,
  RecommendationDiff,
  RecoveryAction,
  RecoveryRecommendation,
  SimulationResult,
  SimulationSummary,
} from './types.js';

interface Candidate {
  id: string;
  addedActions: RecoveryAction[];
  actionLabels: string[];
  sim: SimulationResult;
  diff: RecommendationDiff;
}

const MAX_PAIR_SEEDS_PER_OBJECTIVE = 6;
const MAX_RECOMMENDATIONS = 8;

/**
 * Formats a recovery action into a concise human-readable label.
 */
export function formatActionLabel(action: RecoveryAction): string {
  switch (action.type) {
    case 'SWAP_SPARE':
      return `Swap ${action.spareTail} onto ${action.flightId}`;
    case 'CANCEL_TAIL_END':
      return `Cancel last ${action.count} leg${action.count === 1 ? '' : 's'} on ${action.tailId}`;
    case 'CANCEL_LOOP':
      return action.firstFlightId === action.lastFlightId
        ? `Cancel loop ${action.firstFlightId}`
        : `Cancel loop ${action.firstFlightId}–${action.lastFlightId}`;
    case 'HOLD_CONNECTION':
      return `Hold ${action.connectionId}`;
  }
}

function actionKey(action: RecoveryAction): string {
  switch (action.type) {
    case 'SWAP_SPARE':
      return `SWAP_SPARE:${action.spareTail}:${action.flightId}`;
    case 'CANCEL_TAIL_END':
      return `CANCEL_TAIL_END:${action.tailId}:${action.count}`;
    case 'CANCEL_LOOP':
      return `CANCEL_LOOP:${action.firstFlightId}:${action.lastFlightId}`;
    case 'HOLD_CONNECTION':
      return `HOLD_CONNECTION:${action.connectionId}`;
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

/**
 * Computes RecommendationDiff and sideEffects strictly by diffing two SimulationResults.
 */
function computeDiff(before: SimulationResult, after: SimulationResult): RecommendationDiff {
  const delayDeltaMin = after.summary.totalDelayMin - before.summary.totalDelayMin;
  const lateFlightsDelta = after.summary.lateFlights - before.summary.lateFlights;
  const strandedPaxDelta = after.summary.strandedPax - before.summary.strandedPax;
  const breachesDelta = after.summary.crewBreaches - before.summary.crewBreaches;

  const beforeBreached = new Set(before.crews.filter((c) => c.breached).map((c) => c.crewId));
  const afterBreached = new Set(after.crews.filter((c) => c.breached).map((c) => c.crewId));

  const clearedCrews = [...beforeBreached].filter((id) => !afterBreached.has(id));
  const addedCrews = [...afterBreached].filter((id) => !beforeBreached.has(id));

  const beforeConnById = new Map(before.connections.map((c) => [c.connection_id, c]));
  const savedConnections: Array<{ connection_id: string; passengers: number }> = [];
  const newlyBrokenConnections: Array<{ connection_id: string; passengers: number }> = [];

  for (const afterConn of after.connections) {
    const beforeConn = beforeConnById.get(afterConn.connection_id);
    if (!beforeConn) continue;
    if (beforeConn.status === 'broken' && afterConn.status === 'made') {
      savedConnections.push({
        connection_id: afterConn.connection_id,
        passengers: afterConn.passengers,
      });
    } else if (beforeConn.status !== 'broken' && afterConn.status === 'broken') {
      newlyBrokenConnections.push({
        connection_id: afterConn.connection_id,
        passengers: afterConn.passengers,
      });
    }
  }

  const beforeFlightById = new Map(before.flights.map((f) => [f.flight_id, f]));
  const cancelledFlightIds: string[] = [];
  let cancelledPax = 0;
  for (const afterFlight of after.flights) {
    const beforeFlight = beforeFlightById.get(afterFlight.flight_id);
    if (afterFlight.cancelled && (!beforeFlight || !beforeFlight.cancelled)) {
      cancelledFlightIds.push(afterFlight.flight_id);
      cancelledPax += afterFlight.pax;
    }
  }

  const sideEffects: string[] = [];
  for (const crewId of clearedCrews) {
    sideEffects.push(`clears ${crewId}`);
  }
  for (const crewId of addedCrews) {
    sideEffects.push(`breaches ${crewId}`);
  }
  for (const conn of savedConnections) {
    sideEffects.push(`saves ${conn.connection_id} (${conn.passengers} pax)`);
  }
  for (const conn of newlyBrokenConnections) {
    sideEffects.push(`breaks ${conn.connection_id} for ${conn.passengers} pax`);
  }
  if (cancelledFlightIds.length > 0) {
    sideEffects.push(`cancels ${cancelledFlightIds.join(', ')} (${cancelledPax} pax)`);
  }
  if (delayDeltaMin < 0) {
    sideEffects.push(`cuts ${Math.abs(delayDeltaMin)}m delay`);
  } else if (delayDeltaMin > 0) {
    sideEffects.push(`adds +${delayDeltaMin}m delay`);
  }

  return {
    delayDeltaMin,
    lateFlightsDelta,
    strandedPaxDelta,
    breachesDelta,
    clearedCrews,
    addedCrews,
    savedConnections,
    newlyBrokenConnections,
    cancelledFlightIds,
    cancelledPax,
    sideEffects,
  };
}

function compareCandidates(a: Candidate, b: Candidate, objective: Objective): number {
  const sa = a.sim.summary;
  const sb = b.sim.summary;

  switch (objective) {
    case 'compliance': {
      if (sa.crewBreaches !== sb.crewBreaches) return sa.crewBreaches - sb.crewBreaches;
      if (sa.strandedPax !== sb.strandedPax) return sa.strandedPax - sb.strandedPax;
      if (sa.totalDelayMin !== sb.totalDelayMin) return sa.totalDelayMin - sb.totalDelayMin;
      if (sa.totalCrewOverageMin !== sb.totalCrewOverageMin) {
        return sa.totalCrewOverageMin - sb.totalCrewOverageMin;
      }
      break;
    }
    case 'passengers': {
      if (sa.strandedPax !== sb.strandedPax) return sa.strandedPax - sb.strandedPax;
      if (sa.crewBreaches !== sb.crewBreaches) return sa.crewBreaches - sb.crewBreaches;
      if (sa.totalDelayMin !== sb.totalDelayMin) return sa.totalDelayMin - sb.totalDelayMin;
      break;
    }
    case 'delay': {
      if (sa.totalDelayMin !== sb.totalDelayMin) return sa.totalDelayMin - sb.totalDelayMin;
      if (sa.crewBreaches !== sb.crewBreaches) return sa.crewBreaches - sb.crewBreaches;
      if (sa.strandedPax !== sb.strandedPax) return sa.strandedPax - sb.strandedPax;
      break;
    }
  }

  if (sa.lateFlights !== sb.lateFlights) return sa.lateFlights - sb.lateFlights;
  if (a.addedActions.length !== b.addedActions.length) {
    return a.addedActions.length - b.addedActions.length;
  }
  return a.id.localeCompare(b.id);
}

function generateSingleActions(dataset: FlightNetworkDataset, baseSim: SimulationResult): RecoveryAction[] {
  const actions: RecoveryAction[] = [];

  // 1. Valid SWAP_SPARE actions (matching spare hub & active flight origin).
  for (const spare of dataset.spare_aircraft) {
    for (const f of baseSim.flights) {
      if (!f.cancelled && f.origin === spare.base) {
        actions.push({ type: 'SWAP_SPARE', spareTail: spare.tail_id, flightId: f.flight_id });
      }
    }
  }

  // Group active flights by operatingTail for tail-end and loop cancellations.
  const activeByTail = new Map<string, typeof baseSim.flights>();
  for (const f of baseSim.flights) {
    if (f.cancelled) continue;
    let list = activeByTail.get(f.operatingTail);
    if (!list) {
      list = [];
      activeByTail.set(f.operatingTail, list);
    }
    list.push(f);
  }
  const sortedTails = [...activeByTail.keys()].sort((a, b) => a.localeCompare(b));

  for (const tailId of sortedTails) {
    const chain = activeByTail.get(tailId)!.slice().sort((a, b) => a.leg_order - b.leg_order);
    // 2. CANCEL_TAIL_END for k = 1..chain.length
    for (let count = 1; count <= chain.length; count += 1) {
      actions.push({ type: 'CANCEL_TAIL_END', tailId, count });
    }
    // 3. CANCEL_LOOP for contiguous origin === destination runs
    for (let i = 0; i < chain.length; i += 1) {
      for (let j = i; j < chain.length; j += 1) {
        if (chain[i].origin === chain[j].destination) {
          actions.push({
            type: 'CANCEL_LOOP',
            firstFlightId: chain[i].flight_id,
            lastFlightId: chain[j].flight_id,
          });
        }
      }
    }
  }

  // 4. HOLD_CONNECTION for currently broken connections
  for (const conn of baseSim.connections) {
    if (conn.status === 'broken') {
      actions.push({ type: 'HOLD_CONNECTION', connectionId: conn.connection_id });
    }
  }

  return actions;
}

function actionsObviouslyConflict(a: RecoveryAction, b: RecoveryAction): boolean {
  if (actionKey(a) === actionKey(b)) return true;
  if (a.type === 'SWAP_SPARE' && b.type === 'SWAP_SPARE' && a.spareTail === b.spareTail) {
    return true;
  }
  if (a.type === 'CANCEL_TAIL_END' && b.type === 'CANCEL_TAIL_END' && a.tailId === b.tailId) {
    return true;
  }
  if (a.type === 'HOLD_CONNECTION' && b.type === 'HOLD_CONNECTION' && a.connectionId === b.connectionId) {
    return true;
  }
  return false;
}

function evaluateCandidatePool(
  dataset: FlightNetworkDataset,
  closure: ClosureSpec | null,
  baseActions: readonly RecoveryAction[]
): { baseSim: SimulationResult; candidates: Candidate[] } | null {
  const baseOutcome = simulateNetwork(dataset, closure, baseActions);
  if (!baseOutcome.ok) {
    return null;
  }
  const baseSim = baseOutcome;

  if (
    baseSim.summary.lateFlights === 0 &&
    baseSim.summary.brokenConnections === 0 &&
    baseSim.summary.crewBreaches === 0
  ) {
    return { baseSim, candidates: [] };
  }

  const seenPlans = new Set<string>();
  const singleCandidates: Candidate[] = [];

  for (const action of generateSingleActions(dataset, baseSim)) {
    const planKey = canonicalPlanKey([action]);
    if (seenPlans.has(planKey)) continue;

    const sim = simulateNetwork(dataset, closure, [...baseActions, action]);
    if (!sim.ok) continue;
    if (!improvesSummary(baseSim.summary, sim.summary)) continue;

    seenPlans.add(planKey);
    singleCandidates.push({
      id: actionKey(action),
      addedActions: [action],
      actionLabels: [formatActionLabel(action)],
      sim,
      diff: computeDiff(baseSim, sim),
    });
  }

  const allCandidates: Candidate[] = [...singleCandidates];

  // Test top non-conflicting pairs + hold follow-ups while crew breaches remain.
  if (baseSim.summary.crewBreaches > 0 && singleCandidates.length > 0) {
    const seedMap = new Map<string, Candidate>();
    const objectives: Objective[] = ['compliance', 'passengers', 'delay'];
    for (const obj of objectives) {
      const top = singleCandidates.slice().sort((a, b) => compareCandidates(a, b, obj));
      for (const cand of top.slice(0, MAX_PAIR_SEEDS_PER_OBJECTIVE)) {
        seedMap.set(cand.id, cand);
      }
    }
    const seeds = [...seedMap.values()];

    const tryAddPair = (first: Candidate, secondAction: RecoveryAction, secondBaseline?: SimulationSummary) => {
      if (actionsObviouslyConflict(first.addedActions[0], secondAction)) return;
      const pair = [first.addedActions[0], secondAction];
      const planKey = canonicalPlanKey(pair);
      if (seenPlans.has(planKey)) return;

      const sim = simulateNetwork(dataset, closure, [...baseActions, ...pair]);
      if (!sim.ok) return;
      if (!improvesSummary(first.sim.summary, sim.summary)) return;
      if (secondBaseline && !improvesSummary(secondBaseline, sim.summary)) return;

      seenPlans.add(planKey);
      allCandidates.push({
        id: pair.map(actionKey).join('__'),
        addedActions: pair,
        actionLabels: pair.map(formatActionLabel),
        sim,
        diff: computeDiff(baseSim, sim),
      });
    };

    // Hold follow-ups when an action clears/reduces crew breaches and leaves or creates broken connections.
    for (const cand of singleCandidates) {
      if (cand.sim.summary.crewBreaches < baseSim.summary.crewBreaches) {
        for (const conn of cand.sim.connections) {
          if (conn.status === 'broken') {
            const holdAction: RecoveryAction = {
              type: 'HOLD_CONNECTION',
              connectionId: conn.connection_id,
            };
            const holdSingle = singleCandidates.find(
              (s) => s.addedActions[0].type === 'HOLD_CONNECTION' && s.addedActions[0].connectionId === conn.connection_id
            );
            tryAddPair(cand, holdAction, holdSingle?.sim.summary);
          }
        }
      }
    }

    // Top non-conflicting pairs across objectives while crew breaches remain.
    for (let i = 0; i < seeds.length; i += 1) {
      for (let j = i + 1; j < seeds.length; j += 1) {
        const a = seeds[i];
        const b = seeds[j];
        const aClearsAll = a.sim.summary.crewBreaches === 0;
        const bClearsAll = b.sim.summary.crewBreaches === 0;
        const isCancelPairAfterCleared =
          (aClearsAll || bClearsAll) &&
          (a.addedActions[0].type === 'CANCEL_TAIL_END' || a.addedActions[0].type === 'CANCEL_LOOP') &&
          (b.addedActions[0].type === 'CANCEL_TAIL_END' || b.addedActions[0].type === 'CANCEL_LOOP');
        if (isCancelPairAfterCleared) continue;

        tryAddPair(a, b.addedActions[0], b.sim.summary);
      }
    }
  }

  return { baseSim, candidates: allCandidates };
}

function toRecommendation(cand: Candidate, objective: Objective): RecoveryRecommendation {
  return {
    id: cand.id,
    title: cand.actionLabels.join(' + '),
    actions: [...cand.addedActions],
    actionLabels: [...cand.actionLabels],
    objective,
    summary: cand.sim.summary,
    diff: cand.diff,
    sideEffects: cand.diff.sideEffects,
  };
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
  const evaluated = evaluateCandidatePool(dataset, closure, baseActions);
  if (!evaluated) return [];

  return evaluated.candidates
    .slice()
    .sort((a, b) => compareCandidates(a, b, objective))
    .slice(0, MAX_RECOMMENDATIONS)
    .map((c) => toRecommendation(c, objective));
}

/**
 * Evaluates and ranks recovery recommendations across all three objectives.
 */
export function compareObjectives(
  dataset: FlightNetworkDataset,
  closure: ClosureSpec | null,
  baseActions: readonly RecoveryAction[] = []
): Record<Objective, RecoveryRecommendation[]> {
  const evaluated = evaluateCandidatePool(dataset, closure, baseActions);
  if (!evaluated) {
    return { compliance: [], passengers: [], delay: [] };
  }

  const rankFor = (objective: Objective): RecoveryRecommendation[] =>
    evaluated.candidates
      .slice()
      .sort((a, b) => compareCandidates(a, b, objective))
      .slice(0, MAX_RECOMMENDATIONS)
      .map((c) => toRecommendation(c, objective));

  return {
    compliance: rankFor('compliance'),
    passengers: rankFor('passengers'),
    delay: rankFor('delay'),
  };
}
