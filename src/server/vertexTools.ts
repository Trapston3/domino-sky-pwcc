import { Type, type FunctionDeclaration } from '@google/genai';
import {
  compareObjectives,
  diffSimulations,
  formatActionLabel,
  simulateNetwork,
} from '../engine/index.js';
import type {
  ClosureSpec,
  EngineErrorCode,
  FlightNetworkDataset,
  RecoveryAction,
  SimulationResult,
} from '../engine/types.js';
import { MAX_ACTIONS } from './validate.js';
import { buildDatasetEnums, isPlainObject, validateRecoveryActions } from './validateActions.js';

export interface ToolFailureResult {
  ok: false;
  code: EngineErrorCode;
  reason: string;
}

export type ToolExecutionResult =
  | ToolFailureResult
  | {
      ok: true;
      [key: string]: unknown;
    };

/**
 * Build the Gemini function declarations for the three engine-backed server tools:
 * `simulate_custom_actions`, `inspect_flight`, and `compare_objectives`.
 */
export function buildDispatchToolDeclarations(): FunctionDeclaration[] {
  return [
    {
      name: 'simulate_custom_actions',
      description:
        'Simulate a candidate recovery action plan on the current network closure using the deterministic engine and return resulting KPIs and diffs.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          actions: {
            type: Type.ARRAY,
            description: 'Recovery actions to test (SWAP_SPARE, CANCEL_TAIL_END, CANCEL_LOOP, HOLD_CONNECTION).',
            items: {
              type: Type.OBJECT,
              properties: {
                type: {
                  type: Type.STRING,
                  description: 'Action type: SWAP_SPARE | CANCEL_TAIL_END | CANCEL_LOOP | HOLD_CONNECTION',
                },
                spareTail: { type: Type.STRING, description: 'Spare aircraft tail ID for SWAP_SPARE.' },
                flightId: { type: Type.STRING, description: 'Target flight ID for SWAP_SPARE.' },
                tailId: { type: Type.STRING, description: 'Aircraft tail ID for CANCEL_TAIL_END.' },
                count: { type: Type.INTEGER, description: 'Final leg count to cancel for CANCEL_TAIL_END.' },
                firstFlightId: { type: Type.STRING, description: 'First flight ID in loop for CANCEL_LOOP.' },
                lastFlightId: { type: Type.STRING, description: 'Last flight ID in loop for CANCEL_LOOP.' },
                connectionId: { type: Type.STRING, description: 'Connection ID for HOLD_CONNECTION.' },
              },
              required: ['type'],
            },
          },
        },
        required: ['actions'],
      },
    },
    {
      name: 'inspect_flight',
      description:
        'Inspect a specific flight ID in the current simulation, including delay breakdown, causeSteps, tail chain, crew status, and passenger connections.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          flight_id: {
            type: Type.STRING,
            description: 'Scheduled flight ID from the dataset (e.g. DS0701, DS0802).',
          },
        },
        required: ['flight_id'],
      },
    },
    {
      name: 'compare_objectives',
      description:
        'Compare top ranked recovery recommendations across all three dispatch objectives (compliance, passengers, delay) for the active scenario.',
      parameters: {
        type: Type.OBJECT,
        properties: {},
      },
    },
  ];
}

function actionKey(action: RecoveryAction): string {
  switch (action.type) {
    case 'SWAP_SPARE':
      return `${action.type}:${action.spareTail}:${action.flightId}`;
    case 'CANCEL_TAIL_END':
      return `${action.type}:${action.tailId}:${action.count}`;
    case 'CANCEL_LOOP':
      return `${action.type}:${action.firstFlightId}:${action.lastFlightId}`;
    case 'HOLD_CONNECTION':
      return `${action.type}:${action.connectionId}`;
  }
}

function parseCandidateAction(raw: unknown): RecoveryAction | null {
  if (!isPlainObject(raw) || typeof raw['type'] !== 'string') return null;
  switch (raw['type']) {
    case 'SWAP_SPARE':
      return typeof raw['spareTail'] === 'string' && typeof raw['flightId'] === 'string'
        ? { type: 'SWAP_SPARE', spareTail: raw['spareTail'], flightId: raw['flightId'] }
        : null;
    case 'CANCEL_TAIL_END':
      return typeof raw['tailId'] === 'string' && typeof raw['count'] === 'number'
        ? { type: 'CANCEL_TAIL_END', tailId: raw['tailId'], count: raw['count'] }
        : null;
    case 'CANCEL_LOOP':
      return typeof raw['firstFlightId'] === 'string' && typeof raw['lastFlightId'] === 'string'
        ? { type: 'CANCEL_LOOP', firstFlightId: raw['firstFlightId'], lastFlightId: raw['lastFlightId'] }
        : null;
    case 'HOLD_CONNECTION':
      return typeof raw['connectionId'] === 'string'
        ? { type: 'HOLD_CONNECTION', connectionId: raw['connectionId'] }
        : null;
    default:
      return null;
  }
}

function runSimulateCustomActions(
  args: Record<string, unknown>,
  dataset: FlightNetworkDataset,
  closure: ClosureSpec | null,
  baseActions: readonly RecoveryAction[],
  activeSim: SimulationResult,
): ToolExecutionResult {
  const rawActions = args['actions'];
  if (!Array.isArray(rawActions)) {
    return { ok: false, code: 'INVALID_ACTION', reason: 'actions must be an array of recovery actions.' };
  }

  const parsedActions: RecoveryAction[] = [];
  for (const item of rawActions) {
    const parsed = parseCandidateAction(item);
    if (!parsed) {
      return { ok: false, code: 'INVALID_ACTION', reason: 'Invalid recovery action structure.' };
    }
    parsedActions.push(parsed);
  }

  const combined: RecoveryAction[] = [...baseActions];
  for (const candidate of parsedActions) {
    if (!combined.some((existing) => actionKey(existing) === actionKey(candidate))) {
      combined.push(candidate);
    }
  }

  if (combined.length > MAX_ACTIONS) {
    return {
      ok: false,
      code: 'INVALID_ACTION',
      reason: `At most ${MAX_ACTIONS} stacked recovery actions are permitted.`,
    };
  }

  const enums = buildDatasetEnums(dataset);
  const validated = validateRecoveryActions(combined, enums, MAX_ACTIONS);
  if (!validated.ok) {
    return { ok: false, code: 'INVALID_ACTION', reason: validated.failure.error };
  }

  const outcome = simulateNetwork(dataset, closure, validated.actions);
  if (!outcome.ok) {
    return { ok: false, code: outcome.code, reason: outcome.reason };
  }

  const diff = diffSimulations(activeSim, outcome);

  return {
    ok: true,
    validSchema: true,
    actionLabels: combined.map((a) => formatActionLabel(a)),
    summary: outcome.summary,
    diff,
    sideEffects: diff.sideEffects,
  };
}

function runInspectFlight(args: Record<string, unknown>, activeSim: SimulationResult): ToolExecutionResult {
  const rawId = typeof args['flight_id'] === 'string' ? args['flight_id'].trim().toUpperCase() : '';
  if (!rawId) {
    return { ok: false, code: 'FLIGHT_NOT_FOUND', reason: 'flight_id is required.' };
  }

  const flight = activeSim.flights.find((f) => f.flight_id.toUpperCase() === rawId);
  if (!flight) {
    return {
      ok: false,
      code: 'FLIGHT_NOT_FOUND',
      reason: `Flight ${rawId} was not found in the active network dataset.`,
    };
  }

  const tailChain = activeSim.flights
    .filter((f) => f.operatingTail === flight.operatingTail)
    .sort((a, b) => a.leg_order - b.leg_order)
    .map((f) => ({
      flight_id: f.flight_id,
      leg_order: f.leg_order,
      origin: f.origin,
      destination: f.destination,
      schedDep: f.dep,
      schedArr: f.arr,
      actualDep: f.actualDepStr,
      actualArr: f.actualArrStr,
      delayMin: f.delayMin,
      cancelled: f.cancelled,
      status: f.status,
    }));

  const connections = activeSim.connections.filter(
    (c) => c.from_flight === flight.flight_id || c.to_flight === flight.flight_id,
  );
  const crew = activeSim.crews.find((c) => c.crewId === flight.crewId) ?? null;

  return { ok: true, flight, tailChain, connections, crew };
}

/**
 * Execute one server-side dispatch tool against the deterministic simulation engine.
 * Invalid plans or unknown flight IDs return `{ ok: false, code, reason }` so the
 * model can inspect the failure without throwing.
 */
export function executeDispatchTool(
  name: string,
  rawArgs: Record<string, unknown> | undefined,
  dataset: FlightNetworkDataset,
  closure: ClosureSpec | null,
  baseActions: readonly RecoveryAction[],
  activeSim: SimulationResult,
): ToolExecutionResult {
  const args = isPlainObject(rawArgs) ? rawArgs : {};
  switch (name) {
    case 'simulate_custom_actions':
      return runSimulateCustomActions(args, dataset, closure, baseActions, activeSim);
    case 'inspect_flight':
      return runInspectFlight(args, activeSim);
    case 'compare_objectives': {
      const comparison = compareObjectives(dataset, closure, baseActions);
      return {
        ok: true,
        currentSummary: activeSim.summary,
        objectives: {
          compliance: comparison.compliance.slice(0, 3),
          passengers: comparison.passengers.slice(0, 3),
          delay: comparison.delay.slice(0, 3),
        },
      };
    }
    default:
      return { ok: false, code: 'INVALID_ACTION', reason: `Unsupported tool "${name}".` };
  }
}
