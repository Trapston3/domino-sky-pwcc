import { executeDispatchTool } from './vertexTools.js';
import type { ClosureSpec, FlightNetworkDataset, RecoveryAction, SimulationResult } from '../engine/types.js';

type ParsedIntent = { action: RecoveryAction; label: string } | null;

function parseIntent(question: string, dataset: FlightNetworkDataset): ParsedIntent {
  const text = question.trim().toUpperCase();
  let match = text.match(/\bSWAP\s+([A-Z0-9-]+)\s+ONTO\s+([A-Z0-9-]+)\b/);
  if (match) {
    const spareTail = dataset.spare_aircraft.find((item) => item.tail_id.toUpperCase() === match?.[1]);
    const flight = dataset.flights.find((item) => item.flight_id.toUpperCase() === match?.[2]);
    return spareTail && flight
      ? { action: { type: 'SWAP_SPARE', spareTail: spareTail.tail_id, flightId: flight.flight_id }, label: `Swap ${spareTail.tail_id} onto ${flight.flight_id}` }
      : null;
  }
  match = text.match(/\bHOLD\s+([A-Z0-9-]+)\b/);
  if (match) {
    const connection = dataset.connections.find((item) => item.connection_id.toUpperCase() === match?.[1]);
    return connection ? { action: { type: 'HOLD_CONNECTION', connectionId: connection.connection_id }, label: `Hold ${connection.connection_id}` } : null;
  }
  match = text.match(/\bCANCEL\s+LOOP\s+([A-Z0-9-]+)\s+([A-Z0-9-]+)\b/);
  if (match) {
    const first = dataset.flights.find((item) => item.flight_id.toUpperCase() === match?.[1]);
    const last = dataset.flights.find((item) => item.flight_id.toUpperCase() === match?.[2]);
    return first && last ? { action: { type: 'CANCEL_LOOP', firstFlightId: first.flight_id, lastFlightId: last.flight_id }, label: `Cancel loop ${first.flight_id} through ${last.flight_id}` } : null;
  }
  match = text.match(/\bCANCEL\s+(?:ONLY\s+)?([A-Z0-9-]+)\b/);
  if (match) {
    const flight = dataset.flights.find((item) => item.flight_id.toUpperCase() === match?.[1]);
    if (!flight) return null;
    const tail = dataset.flights.filter((item) => item.tail_id === flight.tail_id).sort((a, b) => b.leg_order - a.leg_order);
    const action: RecoveryAction = tail[0]?.flight_id === flight.flight_id
      ? { type: 'CANCEL_TAIL_END', tailId: flight.tail_id, count: 1 }
      : { type: 'CANCEL_LOOP', firstFlightId: flight.flight_id, lastFlightId: flight.flight_id };
    return { action, label: `Cancel only ${flight.flight_id}` };
  }
  return null;
}

/** Simulate a narrowly parsed explicit action question; return null when it is not an action request. */
export function answerExplicitActionQuestion(
  question: string,
  dataset: FlightNetworkDataset,
  closure: ClosureSpec | null,
  actions: readonly RecoveryAction[],
  activeSim: SimulationResult,
): string | null {
  const intent = parseIntent(question, dataset);
  if (!intent) return null;
  const result = executeDispatchTool('simulate_custom_actions', { actions: [intent.action] }, dataset, closure, actions, activeSim);
  if (result.ok !== true) return `Cannot apply ${intent.label}: ${result.code} — ${result.reason}`;
  const summary = result['summary'];
  if (typeof summary !== 'object' || summary === null || !('lateFlights' in summary) || !('totalDelayMin' in summary) || !('strandedPax' in summary) || !('crewBreaches' in summary)) {
    return 'The simulation did not return a verified recovery summary.';
  }
  const after = summary as Pick<SimulationResult['summary'], 'lateFlights' | 'totalDelayMin' | 'strandedPax' | 'crewBreaches'>;
  const before = activeSim.summary;
  return `${intent.label} verified. Before → After: late flights ${before.lateFlights} → ${after.lateFlights}, delay ${before.totalDelayMin}m → ${after.totalDelayMin}m, stranded pax ${before.strandedPax} → ${after.strandedPax}, crew breaches ${before.crewBreaches} → ${after.crewBreaches}.`;
}
