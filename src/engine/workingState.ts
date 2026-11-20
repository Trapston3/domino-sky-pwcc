import { parseTimeMin } from './time.js';
import type { ClosureSpec, FlightNetworkDataset, SpareAircraft } from './types.js';

export interface WorkingFlight {
  flight_id: string;
  tail_id: string;
  operatingTail: string;
  leg_order: number;
  origin: string;
  destination: string;
  dep: string;
  arr: string;
  schedDepMin: number;
  schedArrMin: number;
  actualDepMin: number;
  actualArrMin: number;
  block_minutes: number;
  pax: number;
  turnaround_before_min: number | null;
  delayMin: number;
  turnaroundDelayMin: number;
  holdDelayMin: number;
  closureDelayMin: number;
  turnaroundSlackMin: number;
  cancelled: boolean;
  isSwapped: boolean;
  crewId: string;
  crewBreachLeg: boolean;
  heldByConnId: string | null;
  spareWaitMin: number;
}

export interface NormalizedClosure extends ClosureSpec {
  startMin: number;
  endMin: number;
}

export interface UsedSpareInfo {
  spare: SpareAircraft;
  swapFlightId: string;
  availMin: number;
}

export const STANDBY_PRE_DUTY_MIN = 45;
export const DEFAULT_MAX_DUTY_MINS = 600;
export const MAJOR_DELAY_THRESHOLD_MIN = 45;

/**
 * Returns the synthetic standby crew identifier for a swapped spare tail.
 */
export function standbyCrewId(spareTail: string): string {
  return `STBY-${spareTail}`;
}

/**
 * Returns active (non-cancelled) flights for a tail sorted by ascending leg order.
 */
export function getActiveChainByTail(
  flights: readonly WorkingFlight[],
  tailId: string
): WorkingFlight[] {
  return flights
    .filter((f) => !f.cancelled && f.operatingTail === tailId)
    .sort((a, b) => a.leg_order - b.leg_order);
}

/**
 * Groups all active (non-cancelled) flights by operating tail, sorted deterministically.
 */
export function groupActiveChains(
  flights: readonly WorkingFlight[]
): Array<[string, WorkingFlight[]]> {
  const byTail = new Map<string, WorkingFlight[]>();
  for (const f of flights) {
    if (f.cancelled) continue;
    let list = byTail.get(f.operatingTail);
    if (!list) {
      list = [];
      byTail.set(f.operatingTail, list);
    }
    list.push(f);
  }
  const entries = [...byTail.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [, list] of entries) {
    list.sort((a, b) => a.leg_order - b.leg_order);
  }
  return entries;
}

/**
 * Initializes mutable per-simulation flight working records from a dataset.
 */
export function createWorkingFlights(dataset: FlightNetworkDataset): WorkingFlight[] {
  const crewByTail = new Map(dataset.crews.map((c) => [c.tail_id, c]));
  return dataset.flights.map((f) => {
    const schedDepMin = parseTimeMin(f.dep);
    const schedArrMin = parseTimeMin(f.arr);
    const origCrew = crewByTail.get(f.tail_id);
    return {
      flight_id: f.flight_id,
      tail_id: f.tail_id,
      operatingTail: f.tail_id,
      leg_order: f.leg_order,
      origin: f.origin,
      destination: f.destination,
      dep: f.dep,
      arr: f.arr,
      schedDepMin,
      schedArrMin,
      actualDepMin: schedDepMin,
      actualArrMin: schedArrMin,
      block_minutes: f.block_minutes,
      pax: f.pax,
      turnaround_before_min: f.turnaround_before_min,
      delayMin: 0,
      turnaroundDelayMin: 0,
      holdDelayMin: 0,
      closureDelayMin: 0,
      turnaroundSlackMin: 0,
      cancelled: false,
      isSwapped: false,
      crewId: origCrew ? origCrew.crew_id : '',
      crewBreachLeg: false,
      heldByConnId: null,
      spareWaitMin: 0,
    };
  });
}
