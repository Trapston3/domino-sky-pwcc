import type { FlightNetworkDataset, SimulatedFlight, SpareAircraft } from '../engine/types.js';

export interface TimelineRow {
  tailId: string;
  isSpare: boolean;
}

export interface TimelineData {
  allRows: TimelineRow[];
  inactiveSpares: SpareAircraft[];
  timelineStart: number;
  timelineEnd: number;
  totalSpan: number;
  hourTicks: number[];
  flightsByRow: Map<string, { operatedOrCancelled: SimulatedFlight[]; handedOff: SimulatedFlight[] }>;
}

/** Computes grouped tail rows, active/standby spares, and axis bounds for the Tail-Chain CSS timeline. */
export function buildTimelineData(
  dataset: FlightNetworkDataset,
  flights: readonly SimulatedFlight[],
): TimelineData {
  const baseTails: string[] = [];
  const seenBase = new Set<string>();
  for (const f of dataset.flights) {
    if (!seenBase.has(f.tail_id)) {
      seenBase.add(f.tail_id);
      baseTails.push(f.tail_id);
    }
  }

  const activeSpares = dataset.spare_aircraft.filter((sp) =>
    flights.some((f) => !f.cancelled && f.operatingTail === sp.tail_id),
  );
  const inactiveSpares = dataset.spare_aircraft.filter(
    (sp) => !activeSpares.some((a) => a.tail_id === sp.tail_id),
  );

  const allRows: TimelineRow[] = [
    ...baseTails.map((id) => ({ tailId: id, isSpare: false })),
    ...activeSpares.map((sp) => ({ tailId: sp.tail_id, isSpare: true })),
  ];

  let maxArr = 23 * 60 + 30;
  for (const f of flights) {
    maxArr = Math.max(maxArr, f.cancelled ? f.schedArrMin : f.actualArrMin);
  }
  const timelineStart = 5 * 60;
  const timelineEnd = Math.ceil((maxArr + 15) / 60) * 60;
  const totalSpan = timelineEnd - timelineStart;

  const hourTicks: number[] = [];
  for (let t = 6 * 60; t <= timelineEnd; t += 120) {
    hourTicks.push(t);
  }

  const flightsByRow = new Map<string, { operatedOrCancelled: SimulatedFlight[]; handedOff: SimulatedFlight[] }>();
  for (const row of allRows) {
    flightsByRow.set(row.tailId, { operatedOrCancelled: [], handedOff: [] });
  }
  for (const f of flights) {
    if (f.cancelled) {
      flightsByRow.get(f.tail_id)?.operatedOrCancelled.push(f);
    } else {
      flightsByRow.get(f.operatingTail)?.operatedOrCancelled.push(f);
      if (f.operatingTail !== f.tail_id) {
        flightsByRow.get(f.tail_id)?.handedOff.push(f);
      }
    }
  }
  for (const entry of flightsByRow.values()) {
    entry.operatedOrCancelled.sort((a, b) => a.leg_order - b.leg_order);
    entry.handedOff.sort((a, b) => a.leg_order - b.leg_order);
  }

  return { allRows, inactiveSpares, timelineStart, timelineEnd, totalSpan, hourTicks, flightsByRow };
}
