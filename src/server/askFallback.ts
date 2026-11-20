import { formatActionLabel } from '../engine/index.js';
import type {
  Airport,
  ClosureSpec,
  FlightNetworkDataset,
  Objective,
  RecoveryAction,
  RecoveryRecommendation,
  SimulatedConnection,
  SimulatedCrew,
  SimulatedFlight,
  SimulationResult,
} from '../engine/types.js';
import { answerExplicitActionQuestion } from './askActionParser.js';

/** Format the active closure or clear-skies headline and optional reopening surge line. */
export function formatClosureLine(
  dataset: FlightNetworkDataset,
  closure: ClosureSpec | null,
  activeSim: SimulationResult,
): string {
  if (!closure) {
    return `Clear skies across ${dataset.airports.length} airports (${activeSim.summary.totalFlights} scheduled flights).`;
  }
  const airport = dataset.airports.find((a) => a.id === closure.airport);
  const label = airport ? `${closure.airport} (${airport.city})` : closure.airport;
  const surgeText = activeSim.surge
    ? ` Reopening surge: ${activeSim.surge.movements} movements in ${activeSim.surge.windowStartStr}-${activeSim.surge.windowEndStr} vs ${activeSim.surge.capacityPerHour}/hr capacity (${activeSim.surge.percent}%).`
    : '';
  return `Ground stop at ${label} ${closure.start}-${closure.end} IST.${surgeText}`;
}

/** Format the baseline or Before -> After recovery impact summary line. */
export function formatSummaryImpact(
  actions: readonly RecoveryAction[],
  baselineSim: SimulationResult,
  activeSim: SimulationResult,
): string {
  const b = baselineSim.summary;
  const a = activeSim.summary;
  const paxBreakdown = `missed-connection ${a.missedConnectionPax}, cancelled ${a.cancelledPax}`;
  const breachRisk =
    a.crewBreaches > 0
      ? ` (${a.totalCrewOverageMin}m total overage, ${a.crewBreachAtRiskPax} crew-breach at-risk pax)`
      : '';

  if (actions.length === 0) {
    return `Impact: ${a.lateFlights}/${a.totalFlights} flights late (${a.totalDelayMin} delay min), ${a.brokenConnections} broken connections, ${a.strandedPax} stranded pax (${paxBreakdown}), ${a.crewBreaches} crew breaches${breachRisk}.`;
  }
  const applied = actions.map((action) => formatActionLabel(action)).join('; ');
  return `Applied recovery (${actions.length}): ${applied}. Before -> After: late flights ${b.lateFlights} -> ${a.lateFlights}, delay ${b.totalDelayMin}m -> ${a.totalDelayMin}m, stranded pax ${b.strandedPax} -> ${a.strandedPax} (${paxBreakdown}), crew breaches ${b.crewBreaches} -> ${a.crewBreaches}${breachRisk}.`;
}

/** Format up to `limit` worst delayed non-cancelled flights with their cause steps. */
export function formatTopDelays(activeSim: SimulationResult, limit = 3): string | null {
  const worst = activeSim.flights
    .filter((f) => !f.cancelled && f.delayMin > 0)
    .sort((a, b) => b.delayMin - a.delayMin || a.flight_id.localeCompare(b.flight_id))
    .slice(0, limit);
  if (worst.length === 0) return null;
  const items = worst.map((f) => {
    const cause = f.causeSteps.length > 0 ? ` [${f.causeSteps.join(' -> ')}]` : '';
    return `${f.flight_id} (${f.origin}->${f.destination}, +${f.delayMin}m, ${f.actualDepStr}-${f.actualArrStr})${cause}`;
  });
  return `Key delays: ${items.join('; ')}.`;
}

/** Format up to `limit` broken connections ranked by affected passenger count. */
export function formatBrokenConnections(activeSim: SimulationResult, limit = 4): string | null {
  const broken = activeSim.connections
    .filter((c) => c.status === 'broken')
    .sort((a, b) => b.passengers - a.passengers || a.connection_id.localeCompare(b.connection_id))
    .slice(0, limit);
  if (broken.length === 0) return null;
  const items = broken.map(
    (c) => `${c.connection_id} at ${c.airport} (${c.from_flight}->${c.to_flight}, ${c.passengers} pax, short ${c.shortfallMin}m)`,
  );
  return `Broken connections: ${items.join('; ')}.`;
}

/** Format breached crews with overage minutes and breached flight legs. */
export function formatBreachedCrews(activeSim: SimulationResult): string | null {
  const breached = activeSim.crews.filter((c) => c.breached);
  if (breached.length === 0) return null;
  const items = breached.map(
    (c) => `${c.crewId} on ${c.tailId} (+${c.overageMin}m over ${c.maxDutyMins}m limit; legs ${c.breachedFlightIds.join(', ')})`,
  );
  return `Crew duty breaches: ${items.join('; ')}.`;
}

/** Format ranked recovery recommendations with computed side effects for `objective`. */
export function formatRecommendationsBlock(
  objective: Objective,
  recommendations: readonly RecoveryRecommendation[],
  limit = 2,
): string {
  if (recommendations.length === 0) {
    return `No further single or paired recovery options improve objective "${objective}".`;
  }
  const items = recommendations.slice(0, limit).map((rec, idx) => {
    const effects = rec.sideEffects.length > 0 ? ` (${rec.sideEffects.join('; ')})` : '';
    return `#${idx + 1} ${rec.actionLabels.join(' + ')} -> late ${rec.summary.lateFlights}, delay ${rec.summary.totalDelayMin}m, stranded pax ${rec.summary.strandedPax}, breaches ${rec.summary.crewBreaches}${effects}`;
  });
  return `Recommended (${objective}): ${items.join(' | ')}.`;
}

function formatFlightDetail(
  flight: SimulatedFlight,
  baselineFlight: SimulatedFlight | undefined,
  connections: readonly SimulatedConnection[],
): string {
  const route = `${flight.origin}->${flight.destination}`;
  const tailNote = flight.isSwapped ? `${flight.operatingTail} (swapped from ${flight.tail_id})` : flight.operatingTail;
  const parts: string[] = [];

  if (flight.cancelled) {
    parts.push(`${flight.flight_id} (${route}, tail ${flight.tail_id}, sched ${flight.dep}-${flight.arr}, ${flight.pax} pax): CANCELLED.`);
  } else {
    const delayLabel = flight.delayMin > 0 ? `+${flight.delayMin}m delay` : 'on time';
    const breachLabel = flight.crewBreachLeg ? ' [CREW BREACH LEG]' : '';
    parts.push(
      `${flight.flight_id} (${route}, tail ${tailNote}): ${flight.actualDepStr}-${flight.actualArrStr} (sched ${flight.dep}-${flight.arr}, ${delayLabel}, ${flight.pax} pax, crew ${flight.crewId}${breachLabel}).`,
    );
  }
  if (baselineFlight && baselineFlight.delayMin !== flight.delayMin && !flight.cancelled) {
    parts.push(`Baseline before recovery: +${baselineFlight.delayMin}m.`);
  }
  if (flight.causeSteps.length > 0) {
    parts.push(`Cause: ${flight.causeSteps.join(' -> ')}.`);
  }
  const touching = connections.filter((c) => c.from_flight === flight.flight_id || c.to_flight === flight.flight_id);
  if (touching.length > 0) {
    const connText = touching
      .map((c) => `${c.connection_id} (${c.from_flight}->${c.to_flight} at ${c.airport}, ${c.passengers} pax: ${c.status})`)
      .join('; ');
    parts.push(`Connections: ${connText}.`);
  }
  return parts.join(' ');
}

function formatCrewDetail(crew: SimulatedCrew): string {
  const status = crew.breached
    ? `BREACHED +${crew.overageMin}m (${crew.dutyMin}/${crew.maxDutyMins}m)`
    : `within limit (${crew.dutyMin}/${crew.maxDutyMins}m)`;
  const breachedLegs = crew.breachedFlightIds.length > 0 ? `, breached legs: ${crew.breachedFlightIds.join(', ')}` : '';
  return `${crew.crewId} (${crew.isStandby ? 'standby ' : ''}tail ${crew.tailId}, base ${crew.base}): duty ${crew.dutyStartStr}-${crew.lastArrStr}, ${status}, operated ${crew.operatedFlightIds.join(', ') || 'none'}${breachedLegs}.`;
}

function formatConnectionDetail(conn: SimulatedConnection): string {
  const timing =
    conn.status === 'broken' ? `shortfall ${conn.shortfallMin}m` : conn.status === 'made' ? `slack ${conn.slackMin}m` : 'affected by cancellation';
  return `${conn.connection_id} at ${conn.airport} (${conn.from_flight}->${conn.to_flight}, ${conn.passengers} pax, min ${conn.min_connect_minutes}m): ${conn.status} (${timing}${conn.held ? ', held' : ''}).`;
}

function formatTailDetail(tailId: string, activeSim: SimulationResult): string {
  const operated = activeSim.flights.filter((f) => f.operatingTail === tailId && !f.cancelled).sort((a, b) => a.leg_order - b.leg_order);
  const cancelled = activeSim.flights.filter((f) => f.tail_id === tailId && f.cancelled).sort((a, b) => a.leg_order - b.leg_order);
  const crews = activeSim.crews.filter((c) => c.tailId === tailId);
  const legsText = operated
    .map((f) => `${f.flight_id} ${f.origin}->${f.destination} ${f.actualDepStr}-${f.actualArrStr}${f.delayMin > 0 ? ` (+${f.delayMin}m)` : ''}`)
    .join(', ');
  const cancelledText = cancelled.length > 0 ? ` Cancelled: ${cancelled.map((f) => f.flight_id).join(', ')}.` : '';
  const crewText = crews.length > 0 ? ` Crew: ${crews.map(formatCrewDetail).join(' ')}` : '';
  return `Tail ${tailId}: operated ${operated.length} legs (${legsText || 'none'}).${cancelledText}${crewText}`;
}

function formatAirportDetail(airport: Airport, activeSim: SimulationResult): string {
  const deps = activeSim.flights.filter((f) => f.origin === airport.id).length;
  const arrs = activeSim.flights.filter((f) => f.destination === airport.id).length;
  const delayed = activeSim.flights.filter((f) => (f.origin === airport.id || f.destination === airport.id) && !f.cancelled && f.delayMin > 0).length;
  const cancelled = activeSim.flights.filter((f) => (f.origin === airport.id || f.destination === airport.id) && f.cancelled).length;
  const broken = activeSim.connections.filter((c) => c.airport === airport.id && c.status === 'broken').length;
  return `${airport.id} (${airport.city}, capacity ${airport.capacity_per_hour}/hr): ${deps} departures, ${arrs} arrivals, ${delayed} delayed movements, ${cancelled} cancelled movements, ${broken} broken connections.`;
}

/**
 * Answer a dispatch question using only grounded IDs and simulation metrics.
 * Untrusted text inside `question` is matched only against known dataset IDs
 * and topic keywords, and is never echoed verbatim.
 */
export function answerGroundedQuestion(
  dataset: FlightNetworkDataset,
  closure: ClosureSpec | null,
  actions: readonly RecoveryAction[],
  objective: Objective,
  baselineSim: SimulationResult,
  activeSim: SimulationResult,
  recommendations: readonly RecoveryRecommendation[],
  question: string,
): string {
  const actionAnswer = answerExplicitActionQuestion(question, dataset, closure, actions, activeSim);
  if (actionAnswer) return actionAnswer;
  const tokens = new Set((question.toUpperCase().match(/[A-Z0-9-]+/g) ?? []).map((t) => t.trim()));
  const lowerQ = question.toLowerCase();
  const baselineById = new Map(baselineSim.flights.map((f) => [f.flight_id, f]));
  const knownTails = new Set<string>([...dataset.flights.map((f) => f.tail_id), ...dataset.spare_aircraft.map((s) => s.tail_id)]);

  const matchedFlights = activeSim.flights.filter((f) => tokens.has(f.flight_id.toUpperCase()));
  const matchedCrews = activeSim.crews.filter((c) => tokens.has(c.crewId.toUpperCase()));
  const matchedConnections = activeSim.connections.filter((c) => tokens.has(c.connection_id.toUpperCase()));
  const matchedTails = Array.from(knownTails).filter((tail) => tokens.has(tail.toUpperCase()));
  const matchedAirports = dataset.airports.filter((a) => tokens.has(a.id.toUpperCase()) || lowerQ.includes(a.city.toLowerCase()));

  const lines: string[] = [formatClosureLine(dataset, closure, activeSim)];
  for (const flight of matchedFlights.slice(0, 4)) {
    lines.push(formatFlightDetail(flight, baselineById.get(flight.flight_id), activeSim.connections));
  }
  for (const crew of matchedCrews.slice(0, 4)) lines.push(formatCrewDetail(crew));
  for (const conn of matchedConnections.slice(0, 4)) lines.push(formatConnectionDetail(conn));
  for (const tail of matchedTails.slice(0, 3)) lines.push(formatTailDetail(tail, activeSim));
  for (const airport of matchedAirports.slice(0, 3)) lines.push(formatAirportDetail(airport, activeSim));

  const wantsDelay = /\b(why|cause|delay|delays|delayed|late|cascade|worst|impact|domino)\b/i.test(question);
  const wantsCrew = /\b(crew|crews|duty|breach|breaches|breached|overage|overtime|legal|standby)\b/i.test(question);
  const wantsPax = /\b(connect|connection|connections|pax|passenger|passengers|strand|stranded|miss|missed|broken|cancel|canceled|cancelled|cancellation|cancellations)\b/i.test(question);
  const wantsRecovery = /\b(recover|recovery|recommend|recommendation|recommendations|fix|best|option|options|spare|spares|swap|swapped|cancel|hold|holding|action|actions|objective|compare|trade|should)\b/i.test(question);
  const wantsSurge = /\b(surge|reopen|reopening|capacity|backlog)\b/i.test(question);

  const matchedAnyEntity =
    matchedFlights.length > 0 ||
    matchedCrews.length > 0 ||
    matchedConnections.length > 0 ||
    matchedTails.length > 0 ||
    matchedAirports.length > 0;

  if (wantsDelay || !matchedAnyEntity) {
    lines.push(formatSummaryImpact(actions, baselineSim, activeSim));
    const delays = formatTopDelays(activeSim);
    if (delays) lines.push(delays);
  }
  if (wantsCrew) {
    const breached = formatBreachedCrews(activeSim);
    if (breached) {
      lines.push(breached);
    } else {
      const closest = [...activeSim.crews].sort((a, b) => b.dutyMin - a.dutyMin).slice(0, 2).map((c) => `${c.crewId} (${c.dutyMin}/${c.maxDutyMins}m)`).join(', ');
      lines.push(`No crew duty breaches (${activeSim.summary.crewBreaches}). Highest duty: ${closest}.`);
    }
  }
  if (wantsPax) {
    const cancelledCount = activeSim.flights.filter((f) => f.cancelled).length;
    lines.push(`Stranded pax total ${activeSim.summary.strandedPax} (${activeSim.summary.missedConnectionPax} missed-connection + ${activeSim.summary.cancelledPax} cancelled across ${cancelledCount} cancelled flights).`);
    const broken = formatBrokenConnections(activeSim);
    if (broken) lines.push(broken);
  }
  if (wantsSurge && !closure) {
    lines.push('No airport closure is active, so there is no reopening surge window.');
  }
  if (wantsRecovery || !matchedAnyEntity) {
    const sparesText = dataset.spare_aircraft.map((s) => `${s.tail_id} at ${s.base} (from ${s.available_from})`).join(', ');
    if (sparesText) lines.push(`Spares in network: ${sparesText}.`);
    lines.push(formatRecommendationsBlock(objective, recommendations, 3));
  }
  return lines.join('\n');
}
