import type { Connection } from './types.js';
import type { NormalizedClosure, UsedSpareInfo, WorkingFlight } from './workingState.js';

const MAX_CASCADE_PASSES = 10;

export interface CascadeParams {
  activeChains: ReadonlyArray<[string, WorkingFlight[]]>;
  flightById: ReadonlyMap<string, WorkingFlight>;
  usedSpares: ReadonlyMap<string, UsedSpareInfo>;
  heldConnections: ReadonlyMap<string, Connection>;
  closure: NormalizedClosure | null;
  minTurnaround: number;
}

function buildHoldsByToFlight(
  heldConnections: ReadonlyMap<string, Connection>
): Map<string, Connection[]> {
  const holdsByToFlight = new Map<string, Connection[]>();
  for (const conn of heldConnections.values()) {
    let list = holdsByToFlight.get(conn.to_flight);
    if (!list) {
      list = [];
      holdsByToFlight.set(conn.to_flight, list);
    }
    list.push(conn);
  }
  return holdsByToFlight;
}

function updateFlightTiming(
  f: WorkingFlight,
  prev: WorkingFlight | null,
  spareInfo: UsedSpareInfo | undefined,
  holds: readonly Connection[] | undefined,
  params: CascadeParams
): boolean {
  let dep = f.schedDepMin;
  let spareWaitMin = 0;
  if (prev === null && spareInfo && spareInfo.availMin > dep) {
    spareWaitMin = spareInfo.availMin - dep;
    dep = spareInfo.availMin;
  }

  let turnaroundDelayMin = 0;
  if (prev !== null) {
    const minTurnDep = prev.actualArrMin + params.minTurnaround;
    if (minTurnDep > dep) {
      turnaroundDelayMin = minTurnDep - dep;
      dep = minTurnDep;
    }
  }

  let holdDelayMin = 0;
  let heldByConnId: string | null = null;
  if (holds) {
    let maxHoldDep = dep;
    for (const conn of holds) {
      const fromFlight = params.flightById.get(conn.from_flight);
      if (!fromFlight) continue;
      const reqDep = fromFlight.actualArrMin + conn.min_connect_minutes;
      if (reqDep > maxHoldDep) {
        maxHoldDep = reqDep;
        heldByConnId = conn.connection_id;
      }
    }
    if (maxHoldDep > dep) {
      holdDelayMin = maxHoldDep - dep;
      dep = maxHoldDep;
    }
  }

  const depBeforeClosure = dep;
  const closure = params.closure;
  if (
    closure &&
    f.origin === closure.airport &&
    dep >= closure.startMin &&
    dep < closure.endMin
  ) {
    dep = closure.endMin;
  }

  const tentativeArr = dep + f.block_minutes;
  if (
    closure &&
    f.destination === closure.airport &&
    tentativeArr >= closure.startMin &&
    tentativeArr < closure.endMin
  ) {
    dep = closure.endMin - f.block_minutes;
  }

  const closureDelayMin = dep - depBeforeClosure;
  const arr = dep + f.block_minutes;
  const delayMin = arr - f.schedArrMin;
  const turnaroundSlackMin =
    prev !== null ? Math.max(0, dep - prev.actualArrMin - params.minTurnaround) : 0;

  const changed =
    dep !== f.actualDepMin ||
    arr !== f.actualArrMin ||
    turnaroundDelayMin !== f.turnaroundDelayMin ||
    holdDelayMin !== f.holdDelayMin ||
    closureDelayMin !== f.closureDelayMin;

  f.actualDepMin = dep;
  f.actualArrMin = arr;
  f.delayMin = delayMin;
  f.turnaroundDelayMin = turnaroundDelayMin;
  f.holdDelayMin = holdDelayMin;
  f.closureDelayMin = closureDelayMin;
  f.turnaroundSlackMin = turnaroundSlackMin;
  f.heldByConnId = heldByConnId;
  f.spareWaitMin = spareWaitMin;

  return changed;
}

/**
 * Runs the fixed-point delay cascade across operating tail chains (up to 10 passes).
 */
export function runDelayCascade(params: CascadeParams): number {
  const holdsByToFlight = buildHoldsByToFlight(params.heldConnections);
  let passesUsed = 0;

  for (let pass = 1; pass <= MAX_CASCADE_PASSES; pass += 1) {
    let changed = false;

    for (const [tailId, chain] of params.activeChains) {
      const spareInfo = params.usedSpares.get(tailId);
      for (let i = 0; i < chain.length; i += 1) {
        const flight = chain[i];
        const prev = i > 0 ? chain[i - 1] : null;
        const holds = holdsByToFlight.get(flight.flight_id);
        if (updateFlightTiming(flight, prev, spareInfo, holds, params)) {
          changed = true;
        }
      }
    }

    passesUsed = pass;
    if (!changed) {
      break;
    }
  }

  return passesUsed;
}
