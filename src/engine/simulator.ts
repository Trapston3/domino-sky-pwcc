import { applyRecoveryActions } from './actions.js';
import { runDelayCascade } from './cascade.js';
import { buildSimulatedFlights } from './causeSteps.js';
import {
  computeReopeningSurge,
  computeSummary,
  evaluateConnections,
  evaluateCrews,
} from './metrics.js';
import { isValidHHMM, parseTimeMin } from './time.js';
import type {
  ClosureSpec,
  FlightNetworkDataset,
  RecoveryAction,
  SimulationFailure,
  SimulationOutcome,
} from './types.js';
import { createWorkingFlights, type NormalizedClosure } from './workingState.js';

function validateClosure(
  dataset: FlightNetworkDataset,
  closure: ClosureSpec | null | undefined
): { ok: true; value: NormalizedClosure | null } | SimulationFailure {
  if (closure == null) {
    return { ok: true, value: null };
  }
  const airportExists = dataset.airports.some((a) => a.id === closure.airport);
  if (!airportExists) {
    return { ok: false, code: 'INVALID_ACTION', reason: `Unknown closure airport "${closure.airport}".` };
  }
  if (!isValidHHMM(closure.start) || !isValidHHMM(closure.end)) {
    return { ok: false, code: 'INVALID_ACTION', reason: 'Closure times must be valid HH:MM strings.' };
  }
  const startMin = parseTimeMin(closure.start);
  const endMin = parseTimeMin(closure.end);
  if (startMin >= endMin) {
    return {
      ok: false,
      code: 'INVALID_ACTION',
      reason: `Closure start (${closure.start}) must be before end (${closure.end}).`,
    };
  }
  return {
    ok: true,
    value: {
      airport: closure.airport,
      start: closure.start,
      end: closure.end,
      startMin,
      endMin,
    },
  };
}

/**
 * Pure deterministic airline network disruption and recovery simulator.
 */
export function simulateNetwork(
  dataset: FlightNetworkDataset,
  closure: ClosureSpec | null = null,
  actions: readonly RecoveryAction[] = []
): SimulationOutcome {
  const closureCheck = validateClosure(dataset, closure);
  if (!closureCheck.ok) {
    return closureCheck;
  }
  const normalizedClosure = closureCheck.value;

  const workingFlights = createWorkingFlights(dataset);
  const flightById = new Map(workingFlights.map((f) => [f.flight_id, f]));

  const applied = applyRecoveryActions(dataset, workingFlights, flightById, actions);
  if (!applied.ok) {
    return applied;
  }

  const passesUsed = runDelayCascade({
    activeChains: applied.activeChains,
    flightById,
    usedSpares: applied.usedSpares,
    heldConnections: applied.heldConnections,
    closure: normalizedClosure,
    minTurnaround: dataset.meta.min_turnaround_minutes,
  });

  const crews = evaluateCrews(dataset, workingFlights, flightById, applied.usedSpares);

  const flights = buildSimulatedFlights({
    workingFlights,
    activeChains: applied.activeChains,
    flightById,
    connById: new Map(dataset.connections.map((c) => [c.connection_id, c])),
    usedSpares: applied.usedSpares,
    closure: normalizedClosure,
    minTurnaround: dataset.meta.min_turnaround_minutes,
  });

  const connections = evaluateConnections(
    dataset.connections,
    flightById,
    applied.heldConnections
  );
  const surge = computeReopeningSurge(
    new Map(dataset.airports.map((a) => [a.id, a])),
    normalizedClosure,
    flights
  );
  const summary = computeSummary(flights, connections, crews);

  return {
    ok: true,
    closure: normalizedClosure,
    actions: [...actions],
    flights,
    connections,
    crews,
    surge,
    summary,
    passesUsed,
  };
}
