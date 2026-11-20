import { formatTimeMin } from '../engine/index.js';
import type { FlightNetworkDataset, SimulationResult } from '../engine/types.js';

export type EventSeverity = 'storm' | 'breach' | 'delay' | 'spare' | 'info';

export interface TimelineEvent {
  id: string;
  timeMin: number;
  timeStr: string;
  severity: EventSeverity;
  text: string;
  flightId?: string;
  airportId?: string;
}

/** Builds chronological operational events strictly from dataset and simulation results. */
export function buildTimelineEvents(
  dataset: FlightNetworkDataset,
  simulation: SimulationResult,
): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const flightMap = new Map(simulation.flights.map((f) => [f.flight_id, f]));

  if (simulation.closure) {
    const c = simulation.closure;
    const warnMin = Math.max(360, c.startMin - 30);
    events.push({
      id: `storm-warn-${c.airport}-${warnMin}`,
      timeMin: warnMin,
      timeStr: formatTimeMin(warnMin),
      severity: 'storm',
      text: `Storm warning: ${c.airport} ground stop ${c.start}–${c.end} IST`,
      airportId: c.airport,
    });
    events.push({
      id: `storm-start-${c.airport}-${c.startMin}`,
      timeMin: c.startMin,
      timeStr: c.start,
      severity: 'storm',
      text: `Ground stop begins at ${c.airport} until ${c.end} IST`,
      airportId: c.airport,
    });
    const surgeNote = simulation.surge
      ? ` · surge ${simulation.surge.movements}/${simulation.surge.capacityPerHour}/hr (${simulation.surge.percent}%)`
      : '';
    events.push({
      id: `storm-end-${c.airport}-${c.endMin}`,
      timeMin: c.endMin,
      timeStr: c.end,
      severity: 'storm',
      text: `${c.airport} reopens${surgeNote}`,
      airportId: c.airport,
    });
  }

  for (const f of simulation.flights) {
    if (f.cancelled) {
      events.push({
        id: `cancel-${f.flight_id}`,
        timeMin: f.schedDepMin,
        timeStr: f.dep,
        severity: 'delay',
        text: `${f.flight_id} (${f.origin}→${f.destination}) cancelled · ${f.pax} pax`,
        flightId: f.flight_id,
        airportId: f.origin,
      });
      continue;
    }

    if (f.isSwapped) {
      events.push({
        id: `swap-${f.flight_id}`,
        timeMin: f.actualDepMin,
        timeStr: f.actualDepStr,
        severity: 'spare',
        text: `Spare ${f.operatingTail} operates ${f.flight_id} (${f.origin}→${f.destination})`,
        flightId: f.flight_id,
        airportId: f.origin,
      });
    }

    if (f.closureDelayMin > 0) {
      const holdStartMin = f.origin === simulation.closure?.airport ? f.schedDepMin : f.schedArrMin;
      events.push({
        id: `hold-${f.flight_id}`,
        timeMin: holdStartMin,
        timeStr: formatTimeMin(holdStartMin),
        severity: 'delay',
        text: `${f.flight_id} (${f.origin}→${f.destination}) delayed +${f.closureDelayMin}m by ${simulation.closure?.airport ?? 'closure'}`,
        flightId: f.flight_id,
        airportId: simulation.closure?.airport,
      });
    } else if (f.delayMin > 0) {
      events.push({
        id: `ripple-${f.flight_id}`,
        timeMin: f.actualDepMin,
        timeStr: f.actualDepStr,
        severity: f.delayMin >= 45 ? 'breach' : 'delay',
        text: `${f.flight_id} (${f.origin}→${f.destination}) departs +${f.delayMin}m via ${f.operatingTail}`,
        flightId: f.flight_id,
        airportId: f.origin,
      });
    }
  }

  for (const conn of simulation.connections) {
    const fromF = flightMap.get(conn.from_flight);
    const toF = flightMap.get(conn.to_flight);
    if (conn.status === 'broken' && fromF) {
      events.push({
        id: `conn-broken-${conn.connection_id}`,
        timeMin: fromF.actualArrMin,
        timeStr: fromF.actualArrStr,
        severity: 'breach',
        text: `${conn.connection_id} broken at ${conn.airport}: ${conn.from_flight}→${conn.to_flight} (${conn.passengers} pax, -${conn.shortfallMin}m)`,
        flightId: conn.to_flight,
        airportId: conn.airport,
      });
    } else if (conn.held && conn.status === 'made' && toF) {
      events.push({
        id: `conn-held-${conn.connection_id}`,
        timeMin: toF.actualDepMin,
        timeStr: toF.actualDepStr,
        severity: 'spare',
        text: `${conn.connection_id} held at ${conn.airport}: ${conn.passengers} pax saved on ${conn.to_flight}`,
        flightId: conn.to_flight,
        airportId: conn.airport,
      });
    }
  }

  for (const crew of simulation.crews) {
    if (!crew.breached) continue;
    const breachAtMin = crew.dutyStartMin + crew.maxDutyMins;
    events.push({
      id: `crew-breach-${crew.crewId}`,
      timeMin: breachAtMin,
      timeStr: formatTimeMin(breachAtMin),
      severity: 'breach',
      text: `${crew.crewId} (${crew.tailId}) exceeds ${crew.maxDutyMins}m duty (+${crew.overageMin}m on ${crew.breachedFlightIds.join(', ')})`,
      flightId: crew.breachedFlightIds[0],
    });
  }

  if (events.length === 0) {
    for (const f of simulation.flights) {
      if (f.leg_order === 1) {
        const airport = dataset.airports.find((a) => a.id === f.origin);
        events.push({
          id: `nominal-${f.flight_id}`,
          timeMin: f.schedDepMin,
          timeStr: f.dep,
          severity: 'info',
          text: `${f.flight_id} departs ${airport?.city ?? f.origin}→${f.destination} on schedule (${f.operatingTail})`,
          flightId: f.flight_id,
          airportId: f.origin,
        });
      }
    }
  }

  events.sort((a, b) => a.timeMin - b.timeMin || a.id.localeCompare(b.id));
  return events;
}
