import type { FlightNetworkDataset, FlightVisualStatus, SimulatedFlight } from '../engine/types.js';

export type FlightStatusFilter = 'all' | 'disrupted' | FlightVisualStatus;

/** Extracts unique aircraft and spare tail IDs from the dataset in declaration order. */
export function getUniqueTailIds(dataset: FlightNetworkDataset): string[] {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const f of dataset.flights) {
    if (!seen.has(f.tail_id)) {
      seen.add(f.tail_id);
      list.push(f.tail_id);
    }
  }
  for (const sp of dataset.spare_aircraft) {
    if (!seen.has(sp.tail_id)) {
      seen.add(sp.tail_id);
      list.push(sp.tail_id);
    }
  }
  return list;
}

/** Computes counts per flight visual status and total disrupted legs. */
export function countFlightStatuses(flights: readonly SimulatedFlight[]) {
  const counts = {
    all: flights.length,
    disrupted: 0,
    on_time: 0,
    minor_delay: 0,
    major_delay: 0,
    recovered: 0,
    cancelled: 0,
  };
  for (const f of flights) {
    counts[f.status] += 1;
    if (f.delayMin > 0 || f.cancelled || f.crewBreachLeg) counts.disrupted += 1;
  }
  return counts;
}

/** Filters flights by status, airport, tail, and free-text query across route/crew/causeSteps. */
export function filterFlights(
  flights: readonly SimulatedFlight[],
  statusFilter: FlightStatusFilter,
  airportFilter: string,
  tailFilter: string,
  searchQuery: string,
): SimulatedFlight[] {
  const q = searchQuery.trim().toLowerCase();
  return flights.filter((f) => {
    if (statusFilter === 'disrupted') {
      if (f.delayMin === 0 && !f.cancelled && !f.crewBreachLeg) return false;
    } else if (statusFilter !== 'all' && f.status !== statusFilter) {
      return false;
    }
    if (airportFilter && f.origin !== airportFilter && f.destination !== airportFilter) return false;
    if (tailFilter && f.operatingTail !== tailFilter && f.tail_id !== tailFilter) return false;
    if (q) {
      const hay = [f.flight_id, f.origin, f.destination, f.operatingTail, f.tail_id, f.crewId, f.causeSummary, ...f.causeSteps]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
