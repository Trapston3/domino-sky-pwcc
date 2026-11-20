import { parseTimeMin } from './time.js';
import type {
  Connection, FlightNetworkDataset, RecoveryAction, SimulationFailure, SpareAircraft,
} from './types.js';
import {
  getActiveChainByTail, groupActiveChains, standbyCrewId,
  type UsedSpareInfo, type WorkingFlight,
} from './workingState.js';

export interface AppliedRecoveryState {
  ok: true;
  usedSpares: Map<string, UsedSpareInfo>;
  heldConnections: Map<string, Connection>;
  activeChains: Array<[string, WorkingFlight[]]>;
}

interface ActionContext {
  workingFlights: WorkingFlight[];
  flightById: ReadonlyMap<string, WorkingFlight>;
  spareById: ReadonlyMap<string, SpareAircraft>;
  connById: ReadonlyMap<string, Connection>;
  knownTails: ReadonlySet<string>;
  usedSpares: Map<string, UsedSpareInfo>;
  heldConnections: Map<string, Connection>;
}

function fail(code: SimulationFailure['code'], reason: string): SimulationFailure {
  return { ok: false, code, reason };
}

function applySwapSpare(
  ctx: ActionContext,
  action: Extract<RecoveryAction, { type: 'SWAP_SPARE' }>
): SimulationFailure | null {
  const target = ctx.flightById.get(action.flightId);
  if (!target) return fail('FLIGHT_NOT_FOUND', `Flight "${action.flightId}" was not found.`);

  const spare = ctx.spareById.get(action.spareTail);
  if (!spare) return fail('INVALID_ACTION', `Unknown spare aircraft "${action.spareTail}".`);
  if (ctx.usedSpares.has(action.spareTail)) {
    return fail('SPARE_ALREADY_USED', `Spare aircraft ${action.spareTail} is already assigned.`);
  }
  if (target.cancelled) {
    return fail('INVALID_ACTION', `Cannot swap spare onto cancelled flight ${target.flight_id}.`);
  }
  if (target.origin !== spare.base) {
    return fail(
      'SPARE_WRONG_HUB',
      `Spare ${spare.tail_id} is based at ${spare.base}, but ${target.flight_id} departs ${target.origin}.`
    );
  }

  const legs = getActiveChainByTail(ctx.workingFlights, target.operatingTail).filter(
    (f) => f.leg_order >= target.leg_order
  );
  const stbyId = standbyCrewId(spare.tail_id);
  for (const leg of legs) {
    leg.operatingTail = spare.tail_id;
    leg.isSwapped = true;
    leg.crewId = stbyId;
  }
  ctx.usedSpares.set(spare.tail_id, {
    spare,
    swapFlightId: target.flight_id,
    availMin: parseTimeMin(spare.available_from),
  });
  return null;
}

function applyCancelTailEnd(
  ctx: ActionContext,
  action: Extract<RecoveryAction, { type: 'CANCEL_TAIL_END' }>
): SimulationFailure | null {
  if (!ctx.knownTails.has(action.tailId)) {
    return fail('INVALID_ACTION', `Unknown aircraft tail "${action.tailId}".`);
  }
  if (!Number.isInteger(action.count) || action.count <= 0) {
    return fail('INVALID_ACTION', 'Cancel tail-end count must be a positive integer.');
  }
  const activeChain = getActiveChainByTail(ctx.workingFlights, action.tailId);
  if (action.count > activeChain.length) {
    return fail(
      'INVALID_ACTION',
      `Cannot cancel ${action.count} legs on ${action.tailId}; only ${activeChain.length} active legs remain.`
    );
  }
  for (const leg of activeChain.slice(activeChain.length - action.count)) {
    leg.cancelled = true;
  }
  return null;
}

function applyCancelLoop(
  ctx: ActionContext,
  action: Extract<RecoveryAction, { type: 'CANCEL_LOOP' }>
): SimulationFailure | null {
  const first = ctx.flightById.get(action.firstFlightId);
  if (!first) return fail('FLIGHT_NOT_FOUND', `Flight "${action.firstFlightId}" was not found.`);

  const last = ctx.flightById.get(action.lastFlightId);
  if (!last) return fail('FLIGHT_NOT_FOUND', `Flight "${action.lastFlightId}" was not found.`);

  if (first.cancelled || last.cancelled) {
    return fail(
      'INVALID_ACTION',
      `Cannot cancel loop ${action.firstFlightId}–${action.lastFlightId}: a leg is already cancelled.`
    );
  }
  if (first.operatingTail !== last.operatingTail) {
    return fail(
      'BREAKS_AIRCRAFT_CONTINUITY',
      `${first.flight_id} (${first.operatingTail}) and ${last.flight_id} (${last.operatingTail}) are on different operating tails.`
    );
  }
  if (first.leg_order > last.leg_order) {
    return fail(
      'INVALID_ACTION',
      `Loop start ${first.flight_id} (leg ${first.leg_order}) must not follow ${last.flight_id} (leg ${last.leg_order}).`
    );
  }
  if (first.origin !== last.destination) {
    return fail(
      'BREAKS_AIRCRAFT_CONTINUITY',
      `Cancelling ${first.flight_id}–${last.flight_id} (${first.origin}→${last.destination}) breaks aircraft continuity.`
    );
  }

  for (const f of ctx.workingFlights) {
    if (
      !f.cancelled &&
      f.operatingTail === first.operatingTail &&
      f.leg_order >= first.leg_order &&
      f.leg_order <= last.leg_order
    ) {
      f.cancelled = true;
    }
  }
  return null;
}

function applyHoldConnection(
  ctx: ActionContext,
  action: Extract<RecoveryAction, { type: 'HOLD_CONNECTION' }>
): SimulationFailure | null {
  const conn = ctx.connById.get(action.connectionId);
  if (!conn) return fail('INVALID_ACTION', `Unknown connection "${action.connectionId}".`);
  ctx.heldConnections.set(conn.connection_id, conn);
  return null;
}

function validateHeldConnections(
  heldConnections: ReadonlyMap<string, Connection>,
  flightById: ReadonlyMap<string, WorkingFlight>
): SimulationFailure | null {
  for (const conn of heldConnections.values()) {
    const fromF = flightById.get(conn.from_flight);
    const toF = flightById.get(conn.to_flight);
    if (!fromF || !toF) {
      return fail('FLIGHT_NOT_FOUND', `Connection ${conn.connection_id} references a missing flight.`);
    }
    if (fromF.cancelled || toF.cancelled) {
      return fail(
        'INVALID_ACTION',
        `Cannot hold connection ${conn.connection_id} because ${fromF.cancelled ? fromF.flight_id : toF.flight_id} is cancelled.`
      );
    }
  }
  return null;
}

function validateTailContinuity(
  activeChains: ReadonlyArray<[string, WorkingFlight[]]>
): SimulationFailure | null {
  for (const [tailId, chain] of activeChains) {
    for (let i = 1; i < chain.length; i += 1) {
      const [prev, curr] = [chain[i - 1], chain[i]];
      if (prev.destination !== curr.origin) {
        return fail(
          'BREAKS_AIRCRAFT_CONTINUITY',
          `Tail ${tailId} continuity broken between ${prev.flight_id} (arrives ${prev.destination}) and ${curr.flight_id} (departs ${curr.origin}).`
        );
      }
    }
  }
  return null;
}

function applySingleAction(ctx: ActionContext, action: RecoveryAction): SimulationFailure | null {
  switch (action.type) {
    case 'SWAP_SPARE': return applySwapSpare(ctx, action);
    case 'CANCEL_TAIL_END': return applyCancelTailEnd(ctx, action);
    case 'CANCEL_LOOP': return applyCancelLoop(ctx, action);
    case 'HOLD_CONNECTION': return applyHoldConnection(ctx, action);
    default: return fail('INVALID_ACTION', 'Unsupported recovery action type.');
  }
}

/**
 * Validates and applies recovery actions in order, then checks held connections and tail continuity.
 */
export function applyRecoveryActions(
  dataset: FlightNetworkDataset,
  workingFlights: WorkingFlight[],
  flightById: ReadonlyMap<string, WorkingFlight>,
  actions: readonly RecoveryAction[]
): AppliedRecoveryState | SimulationFailure {
  const ctx: ActionContext = {
    workingFlights,
    flightById,
    spareById: new Map(dataset.spare_aircraft.map((s) => [s.tail_id, s])),
    connById: new Map(dataset.connections.map((c) => [c.connection_id, c])),
    knownTails: new Set([
      ...dataset.flights.map((f) => f.tail_id),
      ...dataset.spare_aircraft.map((s) => s.tail_id),
    ]),
    usedSpares: new Map(),
    heldConnections: new Map(),
  };

  for (const action of actions) {
    if (!action || typeof action !== 'object') {
      return fail('INVALID_ACTION', 'Action must be a valid object.');
    }
    const error = applySingleAction(ctx, action);
    if (error) return error;
  }

  const heldError = validateHeldConnections(ctx.heldConnections, flightById);
  if (heldError) return heldError;

  const activeChains = groupActiveChains(workingFlights);
  const continuityError = validateTailContinuity(activeChains);
  if (continuityError) return continuityError;

  return { ok: true, usedSpares: ctx.usedSpares, heldConnections: ctx.heldConnections, activeChains };
}
