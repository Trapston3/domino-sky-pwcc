import { formatTimeMin, parseTimeMin } from './time.js';
import type {
  Airport, Connection, FlightNetworkDataset, ReopeningSurge,
  SimulatedConnection, SimulatedCrew, SimulatedFlight, SimulationSummary,
} from './types.js';
import {
  DEFAULT_MAX_DUTY_MINS, getActiveChainByTail, STANDBY_PRE_DUTY_MIN, standbyCrewId,
  type NormalizedClosure, type UsedSpareInfo, type WorkingFlight,
} from './workingState.js';

function buildCrewRecord(
  crewId: string,
  tailId: string,
  base: string,
  isStandby: boolean,
  dutyStartMin: number,
  maxDutyMins: number,
  operated: readonly WorkingFlight[]
): SimulatedCrew {
  const lastArrMin = operated.length > 0 ? operated[operated.length - 1].actualArrMin : dutyStartMin;
  const dutyMin = operated.length > 0 ? lastArrMin - dutyStartMin : 0;
  const breached = dutyMin > maxDutyMins;
  const overageMin = Math.max(0, dutyMin - maxDutyMins);
  const breachedFlightIds: string[] = [];

  for (const f of operated) {
    f.crewId = crewId;
    const legBreached = f.actualArrMin - dutyStartMin > maxDutyMins;
    f.crewBreachLeg = legBreached;
    if (legBreached) breachedFlightIds.push(f.flight_id);
  }

  return {
    crewId,
    tailId,
    base,
    isStandby,
    dutyStartMin,
    dutyStartStr: formatTimeMin(dutyStartMin),
    lastArrMin,
    lastArrStr: formatTimeMin(lastArrMin),
    dutyMin,
    maxDutyMins,
    breached,
    overageMin,
    operatedFlightIds: operated.map((f) => f.flight_id),
    breachedFlightIds,
  };
}

/**
 * Evaluates duty limits and leg breach flags for scheduled and standby hub crews.
 */
export function evaluateCrews(
  dataset: FlightNetworkDataset,
  workingFlights: readonly WorkingFlight[],
  flightById: ReadonlyMap<string, WorkingFlight>,
  usedSpares: ReadonlyMap<string, UsedSpareInfo>
): SimulatedCrew[] {
  const simCrews: SimulatedCrew[] = [];

  for (const crew of dataset.crews) {
    const operated = crew.flight_ids
      .map((id) => flightById.get(id))
      .filter((f): f is WorkingFlight => f !== undefined && !f.cancelled && f.operatingTail === crew.tail_id)
      .sort((a, b) => a.leg_order - b.leg_order);

    simCrews.push(
      buildCrewRecord(
        crew.crew_id, crew.tail_id, crew.base, false,
        parseTimeMin(crew.duty_start), crew.max_duty_mins, operated
      )
    );
  }

  const defaultMaxDuty = dataset.crews[0]?.max_duty_mins ?? DEFAULT_MAX_DUTY_MINS;
  for (const [spareTail, info] of [...usedSpares.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const operated = getActiveChainByTail(workingFlights, spareTail);
    const swapOrig = flightById.get(info.swapFlightId);
    const firstDepMin =
      operated.length > 0 ? operated[0].actualDepMin : (swapOrig?.schedDepMin ?? info.availMin);
    simCrews.push(
      buildCrewRecord(
        standbyCrewId(spareTail), spareTail, info.spare.base, true,
        firstDepMin - STANDBY_PRE_DUTY_MIN, defaultMaxDuty, operated
      )
    );
  }

  return simCrews;
}

/**
 * Evaluates all passenger connections as made, broken, or cancelled.
 */
export function evaluateConnections(
  connections: readonly Connection[],
  flightById: ReadonlyMap<string, WorkingFlight>,
  heldConnections: ReadonlyMap<string, Connection>
): SimulatedConnection[] {
  return connections.map((conn) => {
    const fromF = flightById.get(conn.from_flight);
    const toF = flightById.get(conn.to_flight);
    const base = {
      connection_id: conn.connection_id,
      airport: conn.airport,
      from_flight: conn.from_flight,
      to_flight: conn.to_flight,
      passengers: conn.passengers,
      min_connect_minutes: conn.min_connect_minutes,
      held: heldConnections.has(conn.connection_id),
    };

    if (!fromF || !toF || fromF.cancelled || toF.cancelled) {
      return { ...base, status: 'cancelled', slackMin: 0, shortfallMin: 0 };
    }

    const diff = toF.actualDepMin - fromF.actualArrMin - conn.min_connect_minutes;
    return {
      ...base,
      status: diff >= 0 ? 'made' : 'broken',
      slackMin: Math.max(0, diff),
      shortfallMin: Math.max(0, -diff),
    };
  });
}

/**
 * Computes informational reopening surge for the closed airport in [end, end + 60).
 */
export function computeReopeningSurge(
  airportById: ReadonlyMap<string, Airport>,
  closure: NormalizedClosure | null,
  simFlights: readonly SimulatedFlight[]
): ReopeningSurge | null {
  if (!closure) return null;
  const airport = airportById.get(closure.airport);
  if (!airport) return null;

  const windowStartMin = closure.endMin;
  const windowEndMin = closure.endMin + 60;
  let movements = 0;

  for (const f of simFlights) {
    if (f.cancelled) continue;
    const depIn = f.origin === closure.airport && f.actualDepMin >= windowStartMin && f.actualDepMin < windowEndMin;
    const arrIn = f.destination === closure.airport && f.actualArrMin >= windowStartMin && f.actualArrMin < windowEndMin;
    if (depIn || arrIn) movements += 1;
  }

  const ratio = airport.capacity_per_hour > 0 ? movements / airport.capacity_per_hour : 0;
  return {
    airport: closure.airport,
    windowStartMin,
    windowEndMin,
    windowStartStr: formatTimeMin(windowStartMin),
    windowEndStr: formatTimeMin(windowEndMin),
    movements,
    capacityPerHour: airport.capacity_per_hour,
    ratio,
    percent: Math.round(ratio * 100),
  };
}

/**
 * Aggregates flight, connection, crew, and non-double-counted passenger headline metrics.
 */
export function computeSummary(
  simFlights: readonly SimulatedFlight[],
  simConnections: readonly SimulatedConnection[],
  simCrews: readonly SimulatedCrew[]
): SimulationSummary {
  const totalFlights = simFlights.length;
  let cancelledFlights = 0;
  let lateFlights = 0;
  let totalDelayMin = 0;
  let cancelledPax = 0;
  let crewBreachAtRiskPax = 0;

  for (const f of simFlights) {
    if (f.cancelled) {
      cancelledFlights += 1;
      cancelledPax += f.pax;
    } else {
      if (f.delayMin > 0) {
        lateFlights += 1;
        totalDelayMin += f.delayMin;
      }
      if (f.crewBreachLeg) crewBreachAtRiskPax += f.pax;
    }
  }

  let brokenConnections = 0;
  let missedConnectionPax = 0;
  for (const c of simConnections) {
    if (c.status === 'broken') {
      brokenConnections += 1;
      missedConnectionPax += c.passengers;
    }
  }

  let crewBreaches = 0;
  let totalCrewOverageMin = 0;
  for (const crew of simCrews) {
    if (crew.breached) {
      crewBreaches += 1;
      totalCrewOverageMin += crew.overageMin;
    }
  }

  const operatedFlights = totalFlights - cancelledFlights;
  return {
    totalFlights,
    operatedFlights,
    onTimeFlights: operatedFlights - lateFlights,
    lateFlights,
    cancelledFlights,
    totalDelayMin,
    brokenConnections,
    missedConnectionPax,
    cancelledPax,
    strandedPax: missedConnectionPax + cancelledPax,
    crewBreaches,
    crewBreachAtRiskPax,
    totalCrewOverageMin,
  };
}
