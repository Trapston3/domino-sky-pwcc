import { formatTimeMin, isValidHHMM, parseTimeMin } from './time.js';
import type {
  ClosureSpec,
  Connection,
  FlightNetworkDataset,
  FlightVisualStatus,
  RecoveryAction,
  ReopeningSurge,
  SimulatedConnection,
  SimulatedCrew,
  SimulatedFlight,
  SimulationFailure,
  SimulationOutcome,
  SimulationSummary,
  SpareAircraft,
} from './types.js';

interface WorkingFlight {
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

interface NormalizedClosure extends ClosureSpec {
  startMin: number;
  endMin: number;
}

interface UsedSpareInfo {
  spare: SpareAircraft;
  swapFlightId: string;
  availMin: number;
}

const MAX_CASCADE_PASSES = 10;
const STANDBY_PRE_DUTY_MIN = 45;
const DEFAULT_MAX_DUTY_MINS = 600;
const MAJOR_DELAY_THRESHOLD_MIN = 45;

function fail(code: SimulationFailure['code'], reason: string): SimulationFailure {
  return { ok: false, code, reason };
}

function standbyCrewId(spareTail: string): string {
  return `STBY-${spareTail}`;
}

function validateClosure(
  dataset: FlightNetworkDataset,
  closure: ClosureSpec | null | undefined
): { ok: true; value: NormalizedClosure | null } | SimulationFailure {
  if (closure == null) {
    return { ok: true, value: null };
  }
  const airportExists = dataset.airports.some((a) => a.id === closure.airport);
  if (!airportExists) {
    return fail('INVALID_ACTION', `Unknown closure airport "${closure.airport}".`);
  }
  if (!isValidHHMM(closure.start) || !isValidHHMM(closure.end)) {
    return fail('INVALID_ACTION', `Closure times must be valid HH:MM strings.`);
  }
  const startMin = parseTimeMin(closure.start);
  const endMin = parseTimeMin(closure.end);
  if (startMin >= endMin) {
    return fail('INVALID_ACTION', `Closure start (${closure.start}) must be before end (${closure.end}).`);
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

function getActiveChainByTail(flights: WorkingFlight[], tailId: string): WorkingFlight[] {
  return flights
    .filter((f) => !f.cancelled && f.operatingTail === tailId)
    .sort((a, b) => a.leg_order - b.leg_order);
}

function groupActiveChains(flights: WorkingFlight[]): Array<[string, WorkingFlight[]]> {
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

function determineVisualStatus(f: WorkingFlight): FlightVisualStatus {
  if (f.cancelled) return 'cancelled';
  if (f.crewBreachLeg || f.delayMin >= MAJOR_DELAY_THRESHOLD_MIN) return 'major_delay';
  if (f.delayMin > 0) return 'minor_delay';
  if (f.isSwapped) return 'recovered';
  return 'on_time';
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

  const airportById = new Map(dataset.airports.map((a) => [a.id, a]));
  const crewByTail = new Map(dataset.crews.map((c) => [c.tail_id, c]));
  const spareById = new Map(dataset.spare_aircraft.map((s) => [s.tail_id, s]));
  const connById = new Map(dataset.connections.map((c) => [c.connection_id, c]));

  const workingFlights: WorkingFlight[] = dataset.flights.map((f) => {
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

  const flightById = new Map(workingFlights.map((f) => [f.flight_id, f]));
  const knownTails = new Set<string>([
    ...dataset.flights.map((f) => f.tail_id),
    ...dataset.spare_aircraft.map((s) => s.tail_id),
  ]);

  const usedSpares = new Map<string, UsedSpareInfo>();
  const heldConnections = new Map<string, Connection>();

  // 1. Validate and apply structural recovery actions in order.
  for (const action of actions) {
    if (!action || typeof action !== 'object') {
      return fail('INVALID_ACTION', 'Action must be a valid object.');
    }

    switch (action.type) {
      case 'SWAP_SPARE': {
        const target = flightById.get(action.flightId);
        if (!target) {
          return fail('FLIGHT_NOT_FOUND', `Flight "${action.flightId}" was not found.`);
        }
        const spare = spareById.get(action.spareTail);
        if (!spare) {
          return fail('INVALID_ACTION', `Unknown spare aircraft "${action.spareTail}".`);
        }
        if (usedSpares.has(action.spareTail)) {
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

        const sourceTail = target.operatingTail;
        const legsToTransfer = getActiveChainByTail(workingFlights, sourceTail).filter(
          (f) => f.leg_order >= target.leg_order
        );
        const stbyId = standbyCrewId(spare.tail_id);
        for (const leg of legsToTransfer) {
          leg.operatingTail = spare.tail_id;
          leg.isSwapped = true;
          leg.crewId = stbyId;
        }
        usedSpares.set(spare.tail_id, {
          spare,
          swapFlightId: target.flight_id,
          availMin: parseTimeMin(spare.available_from),
        });
        break;
      }

      case 'CANCEL_TAIL_END': {
        if (!knownTails.has(action.tailId)) {
          return fail('INVALID_ACTION', `Unknown aircraft tail "${action.tailId}".`);
        }
        if (!Number.isInteger(action.count) || action.count <= 0) {
          return fail('INVALID_ACTION', `Cancel tail-end count must be a positive integer.`);
        }
        const activeChain = getActiveChainByTail(workingFlights, action.tailId);
        if (action.count > activeChain.length) {
          return fail(
            'INVALID_ACTION',
            `Cannot cancel ${action.count} legs on ${action.tailId}; only ${activeChain.length} active legs remain.`
          );
        }
        const toCancel = activeChain.slice(activeChain.length - action.count);
        for (const leg of toCancel) {
          leg.cancelled = true;
        }
        break;
      }

      case 'CANCEL_LOOP': {
        const first = flightById.get(action.firstFlightId);
        if (!first) {
          return fail('FLIGHT_NOT_FOUND', `Flight "${action.firstFlightId}" was not found.`);
        }
        const last = flightById.get(action.lastFlightId);
        if (!last) {
          return fail('FLIGHT_NOT_FOUND', `Flight "${action.lastFlightId}" was not found.`);
        }
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

        const tail = first.operatingTail;
        for (const f of workingFlights) {
          if (
            !f.cancelled &&
            f.operatingTail === tail &&
            f.leg_order >= first.leg_order &&
            f.leg_order <= last.leg_order
          ) {
            f.cancelled = true;
          }
        }
        break;
      }

      case 'HOLD_CONNECTION': {
        const conn = connById.get(action.connectionId);
        if (!conn) {
          return fail('INVALID_ACTION', `Unknown connection "${action.connectionId}".`);
        }
        heldConnections.set(conn.connection_id, conn);
        break;
      }

      default: {
        return fail('INVALID_ACTION', `Unsupported recovery action type.`);
      }
    }
  }

  // Verify held connections do not reference cancelled flights.
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

  // Verify post-action continuity across all operating tails.
  const activeChains = groupActiveChains(workingFlights);
  for (const [tailId, chain] of activeChains) {
    for (let i = 1; i < chain.length; i += 1) {
      const prev = chain[i - 1];
      const curr = chain[i];
      if (prev.destination !== curr.origin) {
        return fail(
          'BREAKS_AIRCRAFT_CONTINUITY',
          `Tail ${tailId} continuity broken between ${prev.flight_id} (arrives ${prev.destination}) and ${curr.flight_id} (departs ${curr.origin}).`
        );
      }
    }
  }

  // 2. Fixed-point delay cascade across operating chains (max 10 passes).
  const minTurnaround = dataset.meta.min_turnaround_minutes;
  const holdsByToFlight = new Map<string, Connection[]>();
  for (const conn of heldConnections.values()) {
    let list = holdsByToFlight.get(conn.to_flight);
    if (!list) {
      list = [];
      holdsByToFlight.set(conn.to_flight, list);
    }
    list.push(conn);
  }

  let passesUsed = 0;
  for (let pass = 1; pass <= MAX_CASCADE_PASSES; pass += 1) {
    let changed = false;

    for (const [tailId, chain] of activeChains) {
      const spareInfo = usedSpares.get(tailId);
      for (let i = 0; i < chain.length; i += 1) {
        const f = chain[i];
        const prev = i > 0 ? chain[i - 1] : null;

        let dep = f.schedDepMin;
        let spareWaitMin = 0;
        if (i === 0 && spareInfo && spareInfo.availMin > dep) {
          spareWaitMin = spareInfo.availMin - dep;
          dep = spareInfo.availMin;
        }

        let turnaroundDelayMin = 0;
        if (prev !== null) {
          const minTurnDep = prev.actualArrMin + minTurnaround;
          if (minTurnDep > dep) {
            turnaroundDelayMin = minTurnDep - dep;
            dep = minTurnDep;
          }
        }

        let holdDelayMin = 0;
        let heldByConnId: string | null = null;
        const holds = holdsByToFlight.get(f.flight_id);
        if (holds) {
          let maxHoldDep = dep;
          for (const conn of holds) {
            const fromFlight = flightById.get(conn.from_flight)!;
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
        if (
          normalizedClosure &&
          f.origin === normalizedClosure.airport &&
          dep >= normalizedClosure.startMin &&
          dep < normalizedClosure.endMin
        ) {
          dep = normalizedClosure.endMin;
        }

        const tentativeArr = dep + f.block_minutes;
        if (
          normalizedClosure &&
          f.destination === normalizedClosure.airport &&
          tentativeArr >= normalizedClosure.startMin &&
          tentativeArr < normalizedClosure.endMin
        ) {
          dep = normalizedClosure.endMin - f.block_minutes;
        }

        const closureDelayMin = dep - depBeforeClosure;
        const arr = dep + f.block_minutes;
        const delayMin = arr - f.schedArrMin;
        const turnaroundSlackMin =
          prev !== null ? Math.max(0, dep - prev.actualArrMin - minTurnaround) : 0;

        if (
          dep !== f.actualDepMin ||
          arr !== f.actualArrMin ||
          turnaroundDelayMin !== f.turnaroundDelayMin ||
          holdDelayMin !== f.holdDelayMin ||
          closureDelayMin !== f.closureDelayMin
        ) {
          changed = true;
        }

        f.actualDepMin = dep;
        f.actualArrMin = arr;
        f.delayMin = delayMin;
        f.turnaroundDelayMin = turnaroundDelayMin;
        f.holdDelayMin = holdDelayMin;
        f.closureDelayMin = closureDelayMin;
        f.turnaroundSlackMin = turnaroundSlackMin;
        f.heldByConnId = heldByConnId;
        f.spareWaitMin = spareWaitMin;
      }
    }

    passesUsed = pass;
    if (!changed) {
      break;
    }
  }

  // Build previous active leg lookup for causeSteps tracing.
  const prevActiveByFlightId = new Map<string, WorkingFlight | null>();
  for (const [, chain] of activeChains) {
    for (let i = 0; i < chain.length; i += 1) {
      prevActiveByFlightId.set(chain[i].flight_id, i > 0 ? chain[i - 1] : null);
    }
  }

  // 3. Evaluate crew duty hours and breach flags.
  const simCrews: SimulatedCrew[] = [];
  for (const crew of dataset.crews) {
    const dutyStartMin = parseTimeMin(crew.duty_start);
    const operated = crew.flight_ids
      .map((id) => flightById.get(id))
      .filter((f): f is WorkingFlight => f !== undefined && !f.cancelled && f.operatingTail === crew.tail_id)
      .sort((a, b) => a.leg_order - b.leg_order);

    const lastArrMin = operated.length > 0 ? operated[operated.length - 1].actualArrMin : dutyStartMin;
    const dutyMin = operated.length > 0 ? lastArrMin - dutyStartMin : 0;
    const breached = dutyMin > crew.max_duty_mins;
    const overageMin = Math.max(0, dutyMin - crew.max_duty_mins);
    const breachedFlightIds: string[] = [];

    for (const f of operated) {
      f.crewId = crew.crew_id;
      const legBreached = f.actualArrMin - dutyStartMin > crew.max_duty_mins;
      f.crewBreachLeg = legBreached;
      if (legBreached) {
        breachedFlightIds.push(f.flight_id);
      }
    }

    simCrews.push({
      crewId: crew.crew_id,
      tailId: crew.tail_id,
      base: crew.base,
      isStandby: false,
      dutyStartMin,
      dutyStartStr: formatTimeMin(dutyStartMin),
      lastArrMin,
      lastArrStr: formatTimeMin(lastArrMin),
      dutyMin,
      maxDutyMins: crew.max_duty_mins,
      breached,
      overageMin,
      operatedFlightIds: operated.map((f) => f.flight_id),
      breachedFlightIds,
    });
  }

  const defaultMaxDuty = dataset.crews[0]?.max_duty_mins ?? DEFAULT_MAX_DUTY_MINS;
  const sortedUsedSpares = [...usedSpares.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [spareTail, info] of sortedUsedSpares) {
    const operated = getActiveChainByTail(workingFlights, spareTail);
    const stbyId = standbyCrewId(spareTail);
    const swapOrig = flightById.get(info.swapFlightId)!;
    const dutyStartMin =
      (operated.length > 0 ? operated[0].actualDepMin : swapOrig.schedDepMin) - STANDBY_PRE_DUTY_MIN;
    const lastArrMin = operated.length > 0 ? operated[operated.length - 1].actualArrMin : dutyStartMin;
    const dutyMin = operated.length > 0 ? lastArrMin - dutyStartMin : 0;
    const breached = dutyMin > defaultMaxDuty;
    const overageMin = Math.max(0, dutyMin - defaultMaxDuty);
    const breachedFlightIds: string[] = [];

    for (const f of operated) {
      f.crewId = stbyId;
      const legBreached = f.actualArrMin - dutyStartMin > defaultMaxDuty;
      f.crewBreachLeg = legBreached;
      if (legBreached) {
        breachedFlightIds.push(f.flight_id);
      }
    }

    simCrews.push({
      crewId: stbyId,
      tailId: spareTail,
      base: info.spare.base,
      isStandby: true,
      dutyStartMin,
      dutyStartStr: formatTimeMin(dutyStartMin),
      lastArrMin,
      lastArrStr: formatTimeMin(lastArrMin),
      dutyMin,
      maxDutyMins: defaultMaxDuty,
      breached,
      overageMin,
      operatedFlightIds: operated.map((f) => f.flight_id),
      breachedFlightIds,
    });
  }

  // 4. Construct human-readable causeSteps[] for every delayed flight.
  const causeStepsCache = new Map<string, string[]>();
  const getCauseSteps = (f: WorkingFlight, stack: Set<string>): string[] => {
    const cached = causeStepsCache.get(f.flight_id);
    if (cached) return cached;
    if (f.cancelled || f.delayMin <= 0 || stack.has(f.flight_id)) {
      return [];
    }

    stack.add(f.flight_id);
    const steps: string[] = [];
    const prev = prevActiveByFlightId.get(f.flight_id) ?? null;

    if (f.spareWaitMin > 0) {
      const spareInfo = usedSpares.get(f.operatingTail);
      const availStr = spareInfo ? spareInfo.spare.available_from : formatTimeMin(f.schedDepMin + f.spareWaitMin);
      steps.push(`spare ${f.operatingTail} available at ${availStr} (+${f.spareWaitMin}m on ${f.flight_id})`);
    }

    if (f.turnaroundDelayMin > 0 && prev) {
      const prevSteps = getCauseSteps(prev, stack);
      for (const s of prevSteps) {
        steps.push(s);
      }
      const schedGap = f.schedDepMin - prev.schedArrMin;
      const absorbed = Math.max(0, schedGap - minTurnaround);
      steps.push(`turnaround absorbed ${absorbed}m before ${f.flight_id} → +${f.turnaroundDelayMin}m carried to ${f.flight_id}`);
    }

    if (f.holdDelayMin > 0 && f.heldByConnId) {
      const conn = connById.get(f.heldByConnId)!;
      const fromF = flightById.get(conn.from_flight)!;
      if (steps.length === 0 && fromF.delayMin > 0) {
        const upstream = getCauseSteps(fromF, stack);
        if (upstream.length > 0) {
          steps.push(upstream[0]);
        }
      }
      steps.push(
        `held +${f.holdDelayMin}m for ${conn.connection_id} (${conn.from_flight} arr ${formatTimeMin(fromF.actualArrMin)} + ${conn.min_connect_minutes}m connect)`
      );
    }

    if (f.closureDelayMin > 0 && normalizedClosure) {
      const holdKind = f.origin === normalizedClosure.airport ? 'departure hold' : 'arrival hold';
      steps.push(
        `${normalizedClosure.airport} closed ${normalizedClosure.start}–${normalizedClosure.end} (+${f.closureDelayMin}m ${holdKind} on ${f.flight_id})`
      );
    }

    if (steps.length === 0 && f.delayMin > 0) {
      steps.push(`delayed +${f.delayMin}m on ${f.flight_id}`);
    }

    stack.delete(f.flight_id);
    causeStepsCache.set(f.flight_id, steps);
    return steps;
  };

  const simFlights: SimulatedFlight[] = workingFlights.map((f) => {
    const causeSteps = getCauseSteps(f, new Set());
    let causeSummary: string;
    if (f.cancelled) {
      causeSummary = 'Cancelled';
    } else if (causeSteps.length > 0) {
      causeSummary = causeSteps.join(' → ');
    } else if (f.isSwapped) {
      causeSummary = `Recovered via spare ${f.operatingTail}`;
    } else {
      causeSummary = 'On time';
    }

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
      causeSummary,
      status: determineVisualStatus(f),
    };
  });

  // 5. Evaluate passenger connections.
  const simConnections: SimulatedConnection[] = dataset.connections.map((conn) => {
    const fromF = flightById.get(conn.from_flight)!;
    const toF = flightById.get(conn.to_flight)!;
    const held = heldConnections.has(conn.connection_id);

    if (fromF.cancelled || toF.cancelled) {
      return {
        connection_id: conn.connection_id,
        airport: conn.airport,
        from_flight: conn.from_flight,
        to_flight: conn.to_flight,
        passengers: conn.passengers,
        min_connect_minutes: conn.min_connect_minutes,
        status: 'cancelled',
        slackMin: 0,
        shortfallMin: 0,
        held,
      };
    }

    const actualConnect = toF.actualDepMin - fromF.actualArrMin;
    const diff = actualConnect - conn.min_connect_minutes;
    return {
      connection_id: conn.connection_id,
      airport: conn.airport,
      from_flight: conn.from_flight,
      to_flight: conn.to_flight,
      passengers: conn.passengers,
      min_connect_minutes: conn.min_connect_minutes,
      status: diff >= 0 ? 'made' : 'broken',
      slackMin: Math.max(0, diff),
      shortfallMin: Math.max(0, -diff),
      held,
    };
  });

  // 6. Compute informational reopening surge.
  let surge: ReopeningSurge | null = null;
  if (normalizedClosure) {
    const airport = airportById.get(normalizedClosure.airport)!;
    const windowStartMin = normalizedClosure.endMin;
    const windowEndMin = normalizedClosure.endMin + 60;
    let movements = 0;
    for (const f of simFlights) {
      if (f.cancelled) continue;
      const depInWindow =
        f.origin === normalizedClosure.airport &&
        f.actualDepMin >= windowStartMin &&
        f.actualDepMin < windowEndMin;
      const arrInWindow =
        f.destination === normalizedClosure.airport &&
        f.actualArrMin >= windowStartMin &&
        f.actualArrMin < windowEndMin;
      if (depInWindow || arrInWindow) {
        movements += 1;
      }
    }
    const ratio = airport.capacity_per_hour > 0 ? movements / airport.capacity_per_hour : 0;
    surge = {
      airport: normalizedClosure.airport,
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

  // 7. Compute headline summary metrics without double-counting.
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
      if (f.crewBreachLeg) {
        crewBreachAtRiskPax += f.pax;
      }
    }
  }

  const operatedFlights = totalFlights - cancelledFlights;
  const onTimeFlights = operatedFlights - lateFlights;

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

  const summary: SimulationSummary = {
    totalFlights,
    operatedFlights,
    onTimeFlights,
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

  return {
    ok: true,
    closure: normalizedClosure,
    actions: [...actions],
    flights: simFlights,
    connections: simConnections,
    crews: simCrews,
    surge,
    summary,
    passesUsed,
  };
}
