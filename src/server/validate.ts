import type {
  ClosureSpec,
  FlightNetworkDataset,
  Objective,
  RecoveryAction,
} from '../engine/types.js';

export const MAX_BODY_BYTES = 8192;
export const MAX_CLOSURE_DURATION_MIN = 240;
export const MAX_ACTIONS = 5;
export const MAX_QUESTION_LENGTH = 300;

const HHMM_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const VALID_MODES = new Set<DispatchMode>(['brief', 'ask']);
const VALID_OBJECTIVES = new Set<Objective>(['compliance', 'passengers', 'delay']);

export type DispatchMode = 'brief' | 'ask';

export type ValidationErrorCode =
  | 'BODY_TOO_LARGE'
  | 'INVALID_PAYLOAD'
  | 'INVALID_MODE'
  | 'INVALID_OBJECTIVE'
  | 'INVALID_CLOSURE'
  | 'INVALID_AIRPORT'
  | 'INVALID_TIME'
  | 'INVALID_CLOSURE_TIME'
  | 'CLOSURE_TOO_LONG'
  | 'INVALID_ACTIONS'
  | 'TOO_MANY_ACTIONS'
  | 'INVALID_ACTION'
  | 'INVALID_QUESTION'
  | 'QUESTION_REQUIRED'
  | 'QUESTION_TOO_LONG';

export interface ValidatedDispatchRequest {
  mode: DispatchMode;
  closure: ClosureSpec | null;
  actions: RecoveryAction[];
  objective: Objective;
  question?: string;
}

export type ValidationResult =
  | { ok: true; data: ValidatedDispatchRequest }
  | { ok: false; status: 400; error: string; code: ValidationErrorCode };

function fail(code: ValidationErrorCode, error: string): ValidationResult {
  return { ok: false, status: 400, error, code };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseHHMM(value: unknown): number | null {
  if (typeof value !== 'string' || !HHMM_REGEX.test(value)) {
    return null;
  }
  const [hoursStr, minsStr] = value.split(':');
  return Number(hoursStr) * 60 + Number(minsStr);
}

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

interface DatasetEnums {
  airportIds: Set<string>;
  flightIds: Set<string>;
  tailLegCounts: Map<string, number>;
  spareTails: Set<string>;
  connectionIds: Set<string>;
}

function buildDatasetEnums(dataset: FlightNetworkDataset): DatasetEnums {
  const tailLegCounts = new Map<string, number>();
  for (const flight of dataset.flights) {
    tailLegCounts.set(flight.tail_id, (tailLegCounts.get(flight.tail_id) ?? 0) + 1);
  }
  return {
    airportIds: new Set(dataset.airports.map((airport) => airport.id)),
    flightIds: new Set(dataset.flights.map((flight) => flight.flight_id)),
    tailLegCounts,
    spareTails: new Set(dataset.spare_aircraft.map((spare) => spare.tail_id)),
    connectionIds: new Set(dataset.connections.map((conn) => conn.connection_id)),
  };
}

function validateClosure(
  rawClosure: unknown,
  airportIds: Set<string>,
): { ok: true; closure: ClosureSpec | null } | { ok: false; failure: ValidationResult } {
  if (rawClosure === null) {
    return { ok: true, closure: null };
  }
  if (!isPlainObject(rawClosure)) {
    return {
      ok: false,
      failure: fail(
        'INVALID_CLOSURE',
        'Closure must be null or an object with airport, start, and end.',
      ),
    };
  }

  const airport = rawClosure['airport'];
  if (typeof airport !== 'string' || !airportIds.has(airport)) {
    return {
      ok: false,
      failure: fail('INVALID_AIRPORT', 'Closure airport must be a valid airport code from the network.'),
    };
  }

  const start = rawClosure['start'];
  const end = rawClosure['end'];
  const startMin = parseHHMM(start);
  const endMin = parseHHMM(end);
  if (startMin === null || endMin === null || typeof start !== 'string' || typeof end !== 'string') {
    return {
      ok: false,
      failure: fail('INVALID_TIME', 'Closure start and end times must use 24-hour HH:MM format.'),
    };
  }

  if (startMin >= endMin) {
    return {
      ok: false,
      failure: fail('INVALID_CLOSURE_TIME', 'Closure end time must be strictly after start time.'),
    };
  }

  if (endMin - startMin > MAX_CLOSURE_DURATION_MIN) {
    return {
      ok: false,
      failure: fail(
        'CLOSURE_TOO_LONG',
        `Closure duration cannot exceed ${MAX_CLOSURE_DURATION_MIN} minutes.`,
      ),
    };
  }

  return {
    ok: true,
    closure: { airport, start, end },
  };
}

function validateAction(
  rawAction: unknown,
  index: number,
  enums: DatasetEnums,
): { ok: true; action: RecoveryAction } | { ok: false; failure: ValidationResult } {
  const position = `Action #${index + 1}`;
  if (!isPlainObject(rawAction)) {
    return {
      ok: false,
      failure: fail('INVALID_ACTION', `${position} must be an object.`),
    };
  }

  const actionType = rawAction['type'];
  switch (actionType) {
    case 'SWAP_SPARE': {
      const spareTail = rawAction['spareTail'];
      const flightId = rawAction['flightId'];
      if (typeof spareTail !== 'string' || !enums.spareTails.has(spareTail)) {
        return {
          ok: false,
          failure: fail('INVALID_ACTION', `${position} references an unknown spare aircraft tail.`),
        };
      }
      if (typeof flightId !== 'string' || !enums.flightIds.has(flightId)) {
        return {
          ok: false,
          failure: fail('INVALID_ACTION', `${position} references an unknown flight ID.`),
        };
      }
      return { ok: true, action: { type: 'SWAP_SPARE', spareTail, flightId } };
    }

    case 'CANCEL_TAIL_END': {
      const tailId = rawAction['tailId'];
      const count = rawAction['count'];
      if (typeof tailId !== 'string' || !enums.tailLegCounts.has(tailId)) {
        return {
          ok: false,
          failure: fail('INVALID_ACTION', `${position} references an unknown aircraft tail.`),
        };
      }
      const maxLegs = enums.tailLegCounts.get(tailId) ?? 0;
      if (
        typeof count !== 'number' ||
        !Number.isInteger(count) ||
        count < 1 ||
        count > maxLegs
      ) {
        return {
          ok: false,
          failure: fail(
            'INVALID_ACTION',
            `${position} cancel count must be an integer between 1 and ${maxLegs}.`,
          ),
        };
      }
      return { ok: true, action: { type: 'CANCEL_TAIL_END', tailId, count } };
    }

    case 'CANCEL_LOOP': {
      const firstFlightId = rawAction['firstFlightId'];
      const lastFlightId = rawAction['lastFlightId'];
      if (
        typeof firstFlightId !== 'string' ||
        !enums.flightIds.has(firstFlightId) ||
        typeof lastFlightId !== 'string' ||
        !enums.flightIds.has(lastFlightId)
      ) {
        return {
          ok: false,
          failure: fail('INVALID_ACTION', `${position} references an unknown flight ID.`),
        };
      }
      return { ok: true, action: { type: 'CANCEL_LOOP', firstFlightId, lastFlightId } };
    }

    case 'HOLD_CONNECTION': {
      const connectionId = rawAction['connectionId'];
      if (typeof connectionId !== 'string' || !enums.connectionIds.has(connectionId)) {
        return {
          ok: false,
          failure: fail('INVALID_ACTION', `${position} references an unknown connection ID.`),
        };
      }
      return { ok: true, action: { type: 'HOLD_CONNECTION', connectionId } };
    }

    default:
      return {
        ok: false,
        failure: fail('INVALID_ACTION', `${position} has an unsupported recovery action type.`),
      };
  }
}

/**
 * Zero-trust request validator for dispatch API payloads.
 * Derives all allowed entity enums strictly from `dataset` and strips all unknown fields.
 */
export function validateDispatchRequest(
  raw: unknown,
  dataset: FlightNetworkDataset,
  rawByteLength?: number,
): ValidationResult {
  if (rawByteLength !== undefined) {
    if (typeof rawByteLength !== 'number' || !Number.isFinite(rawByteLength) || rawByteLength < 0) {
      return fail('INVALID_PAYLOAD', 'Invalid request content length.');
    }
    if (rawByteLength > MAX_BODY_BYTES) {
      return fail(
        'BODY_TOO_LARGE',
        `Request body exceeds the ${MAX_BODY_BYTES}-byte limit.`,
      );
    }
  } else {
    if (typeof raw === 'string') {
      if (utf8ByteLength(raw) > MAX_BODY_BYTES) {
        return fail(
          'BODY_TOO_LARGE',
          `Request body exceeds the ${MAX_BODY_BYTES}-byte limit.`,
        );
      }
      return fail('INVALID_PAYLOAD', 'Request body must be a JSON object.');
    }
    try {
      const serialized = JSON.stringify(raw);
      if (serialized === undefined) {
        return fail('INVALID_PAYLOAD', 'Request body must be a JSON object.');
      }
      if (utf8ByteLength(serialized) > MAX_BODY_BYTES) {
        return fail(
          'BODY_TOO_LARGE',
          `Request body exceeds the ${MAX_BODY_BYTES}-byte limit.`,
        );
      }
    } catch {
      return fail('INVALID_PAYLOAD', 'Request body must be a serializable JSON object.');
    }
  }

  if (!isPlainObject(raw)) {
    return fail('INVALID_PAYLOAD', 'Request body must be a JSON object.');
  }

  const rawMode = raw['mode'];
  if (typeof rawMode !== 'string' || !VALID_MODES.has(rawMode as DispatchMode)) {
    return fail('INVALID_MODE', 'Mode must be either "brief" or "ask".');
  }
  const mode = rawMode as DispatchMode;

  const rawObjective = raw['objective'];
  if (
    typeof rawObjective !== 'string' ||
    !VALID_OBJECTIVES.has(rawObjective as Objective)
  ) {
    return fail(
      'INVALID_OBJECTIVE',
      'Objective must be "compliance", "passengers", or "delay".',
    );
  }
  const objective = rawObjective as Objective;

  const enums = buildDatasetEnums(dataset);

  const closureResult = validateClosure(raw['closure'], enums.airportIds);
  if (!closureResult.ok) {
    return closureResult.failure;
  }

  const rawActions = raw['actions'];
  if (!Array.isArray(rawActions)) {
    return fail('INVALID_ACTIONS', 'Actions must be provided as an array.');
  }
  if (rawActions.length > MAX_ACTIONS) {
    return fail(
      'TOO_MANY_ACTIONS',
      `At most ${MAX_ACTIONS} recovery actions are allowed per request.`,
    );
  }

  const actions: RecoveryAction[] = [];
  for (let i = 0; i < rawActions.length; i++) {
    const actionResult = validateAction(rawActions[i], i, enums);
    if (!actionResult.ok) {
      return actionResult.failure;
    }
    actions.push(actionResult.action);
  }

  const rawQuestion = raw['question'];
  let trimmedQuestion: string | undefined;
  if (rawQuestion !== undefined) {
    if (typeof rawQuestion !== 'string') {
      return fail('INVALID_QUESTION', 'Question must be a text string.');
    }
    const trimmed = rawQuestion.trim();
    if (trimmed.length > MAX_QUESTION_LENGTH) {
      return fail(
        'QUESTION_TOO_LONG',
        `Question must be ${MAX_QUESTION_LENGTH} characters or fewer.`,
      );
    }
    if (trimmed.length > 0) {
      trimmedQuestion = trimmed;
    }
  }

  if (mode === 'ask' && !trimmedQuestion) {
    return fail(
      'QUESTION_REQUIRED',
      'A non-empty question is required when mode is "ask".',
    );
  }

  const sanitized: ValidatedDispatchRequest = {
    mode,
    closure: closureResult.closure,
    actions,
    objective,
    ...(trimmedQuestion !== undefined ? { question: trimmedQuestion } : {}),
  };

  return { ok: true, data: sanitized };
}
