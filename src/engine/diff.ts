import type {
  RecommendationDiff,
  RecoveryAction,
  SimulationResult,
} from './types.js';

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

function buildSideEffects(params: {
  clearedCrews: readonly string[];
  addedCrews: readonly string[];
  savedConnections: ReadonlyArray<{ connection_id: string; passengers: number }>;
  newlyBrokenConnections: ReadonlyArray<{ connection_id: string; passengers: number }>;
  cancelledFlightIds: readonly string[];
  cancelledPax: number;
  delayDeltaMin: number;
}): string[] {
  const sideEffects: string[] = [];
  for (const crewId of params.clearedCrews) {
    sideEffects.push(`clears ${crewId}`);
  }
  for (const crewId of params.addedCrews) {
    sideEffects.push(`breaches ${crewId}`);
  }
  for (const conn of params.savedConnections) {
    sideEffects.push(`saves ${conn.connection_id} (${conn.passengers} pax)`);
  }
  for (const conn of params.newlyBrokenConnections) {
    sideEffects.push(`breaks ${conn.connection_id} for ${conn.passengers} pax`);
  }
  if (params.cancelledFlightIds.length > 0) {
    sideEffects.push(
      `cancels ${params.cancelledFlightIds.join(', ')} (${params.cancelledPax} pax)`
    );
  }
  if (params.delayDeltaMin < 0) {
    sideEffects.push(`cuts ${Math.abs(params.delayDeltaMin)}m delay`);
  } else if (params.delayDeltaMin > 0) {
    sideEffects.push(`adds +${params.delayDeltaMin}m delay`);
  }
  return sideEffects;
}

/**
 * Computes RecommendationDiff and sideEffects strictly by diffing two SimulationResults.
 */
export function diffSimulations(
  before: SimulationResult,
  after: SimulationResult
): RecommendationDiff {
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

  const sideEffects = buildSideEffects({
    clearedCrews,
    addedCrews,
    savedConnections,
    newlyBrokenConnections,
    cancelledFlightIds,
    cancelledPax,
    delayDeltaMin,
  });

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
