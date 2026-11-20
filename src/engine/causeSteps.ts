import { formatTimeMin } from './time.js';
import type { Connection, FlightVisualStatus, SimulatedFlight } from './types.js';
import {
  MAJOR_DELAY_THRESHOLD_MIN,
  type NormalizedClosure,
  type UsedSpareInfo,
  type WorkingFlight,
} from './workingState.js';

export interface CauseStepsParams {
  workingFlights: readonly WorkingFlight[];
  activeChains: ReadonlyArray<[string, WorkingFlight[]]>;
  flightById: ReadonlyMap<string, WorkingFlight>;
  connById: ReadonlyMap<string, Connection>;
  usedSpares: ReadonlyMap<string, UsedSpareInfo>;
  closure: NormalizedClosure | null;
  minTurnaround: number;
}

function buildPrevActiveLookup(
  activeChains: ReadonlyArray<[string, WorkingFlight[]]>
): Map<string, WorkingFlight | null> {
  const prevByFlightId = new Map<string, WorkingFlight | null>();
  for (const [, chain] of activeChains) {
    for (let i = 0; i < chain.length; i += 1) {
      prevByFlightId.set(chain[i].flight_id, i > 0 ? chain[i - 1] : null);
    }
  }
  return prevByFlightId;
}

function determineVisualStatus(f: WorkingFlight): FlightVisualStatus {
  if (f.cancelled) return 'cancelled';
  if (f.crewBreachLeg || f.delayMin >= MAJOR_DELAY_THRESHOLD_MIN) return 'major_delay';
  if (f.delayMin > 0) return 'minor_delay';
  if (f.isSwapped) return 'recovered';
  return 'on_time';
}

function resolveCauseSteps(
  f: WorkingFlight,
  stack: Set<string>,
  cache: Map<string, string[]>,
  prevActiveByFlightId: ReadonlyMap<string, WorkingFlight | null>,
  params: CauseStepsParams
): string[] {
  const cached = cache.get(f.flight_id);
  if (cached) return cached;
  if (f.cancelled || f.delayMin <= 0 || stack.has(f.flight_id)) {
    return [];
  }

  stack.add(f.flight_id);
  const steps: string[] = [];
  const prev = prevActiveByFlightId.get(f.flight_id) ?? null;

  if (f.spareWaitMin > 0) {
    const spareInfo = params.usedSpares.get(f.operatingTail);
    const availStr = spareInfo
      ? spareInfo.spare.available_from
      : formatTimeMin(f.schedDepMin + f.spareWaitMin);
    steps.push(
      `spare ${f.operatingTail} available at ${availStr} (+${f.spareWaitMin}m on ${f.flight_id})`
    );
  }

  if (f.turnaroundDelayMin > 0 && prev) {
    const prevSteps = resolveCauseSteps(prev, stack, cache, prevActiveByFlightId, params);
    for (const step of prevSteps) {
      steps.push(step);
    }
    const schedGap = f.schedDepMin - prev.schedArrMin;
    const absorbed = Math.max(0, schedGap - params.minTurnaround);
    steps.push(
      `turnaround absorbed ${absorbed}m before ${f.flight_id} → +${f.turnaroundDelayMin}m carried to ${f.flight_id}`
    );
  }

  if (f.holdDelayMin > 0 && f.heldByConnId) {
    const conn = params.connById.get(f.heldByConnId);
    const fromF = conn ? params.flightById.get(conn.from_flight) : undefined;
    if (conn && fromF) {
      if (steps.length === 0 && fromF.delayMin > 0) {
        const upstream = resolveCauseSteps(fromF, stack, cache, prevActiveByFlightId, params);
        if (upstream.length > 0) {
          steps.push(upstream[0]);
        }
      }
      steps.push(
        `held +${f.holdDelayMin}m for ${conn.connection_id} (${conn.from_flight} arr ${formatTimeMin(fromF.actualArrMin)} + ${conn.min_connect_minutes}m connect)`
      );
    }
  }

  if (f.closureDelayMin > 0 && params.closure) {
    const holdKind = f.origin === params.closure.airport ? 'departure hold' : 'arrival hold';
    steps.push(
      `${params.closure.airport} closed ${params.closure.start}–${params.closure.end} (+${f.closureDelayMin}m ${holdKind} on ${f.flight_id})`
    );
  }

  if (steps.length === 0 && f.delayMin > 0) {
    steps.push(`delayed +${f.delayMin}m on ${f.flight_id}`);
  }

  stack.delete(f.flight_id);
  cache.set(f.flight_id, steps);
  return steps;
}

function buildCauseSummary(f: WorkingFlight, causeSteps: readonly string[]): string {
  if (f.cancelled) return 'Cancelled';
  if (causeSteps.length > 0) return causeSteps.join(' → ');
  if (f.isSwapped) return `Recovered via spare ${f.operatingTail}`;
  return 'On time';
}

/**
 * Builds final SimulatedFlight objects with human-readable causeSteps and causeSummary.
 */
export function buildSimulatedFlights(params: CauseStepsParams): SimulatedFlight[] {
  const prevActiveByFlightId = buildPrevActiveLookup(params.activeChains);
  const cache = new Map<string, string[]>();

  return params.workingFlights.map((f) => {
    const causeSteps = resolveCauseSteps(f, new Set(), cache, prevActiveByFlightId, params);
    return {
      flight_id: f.flight_id,
      tail_id: f.tail_id,
      operatingTail: f.operatingTail,
      leg_order: f.leg_order,
      origin: f.origin,
      destination: f.destination,
      dep: f.dep,
      arr: f.arr,
      schedDepMin: f.schedDepMin,
      schedArrMin: f.schedArrMin,
      actualDepMin: f.actualDepMin,
      actualArrMin: f.actualArrMin,
      actualDepStr: formatTimeMin(f.actualDepMin),
      actualArrStr: formatTimeMin(f.actualArrMin),
      block_minutes: f.block_minutes,
      pax: f.pax,
      turnaround_before_min: f.turnaround_before_min,
      delayMin: f.cancelled ? 0 : f.delayMin,
      turnaroundDelayMin: f.cancelled ? 0 : f.turnaroundDelayMin,
      holdDelayMin: f.cancelled ? 0 : f.holdDelayMin,
      closureDelayMin: f.cancelled ? 0 : f.closureDelayMin,
      turnaroundSlackMin: f.cancelled ? 0 : f.turnaroundSlackMin,
      cancelled: f.cancelled,
      isSwapped: f.isSwapped,
      crewId: f.crewId,
      crewBreachLeg: f.cancelled ? false : f.crewBreachLeg,
      causeSteps,
      causeSummary: buildCauseSummary(f, causeSteps),
      status: determineVisualStatus(f),
    };
  });
}
