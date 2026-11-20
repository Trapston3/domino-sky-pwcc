import type { FlightNetworkDataset, RecoveryAction } from '../engine/types.js';

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

export interface ValidationFailure {
  ok: false;
  status: 400;
  error: string;
  code: ValidationErrorCode;
}

export interface DatasetEnums {
  airportIds: Set<string>;
  flightIds: Set<string>;
  tailLegCounts: Map<string, number>;
  spareTails: Set<string>;
  connectionIds: Set<string>;
}

/**
 * Return true when `value` is a non-null, non-array plain object record.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Construct a standardized 400 validation failure response without internals.
 */
export function validationFail(code: ValidationErrorCode, error: string): ValidationFailure {
  return { ok: false, status: 400, error, code };
}

/**
 * Derive allowed airport, flight, tail, spare, and connection enums from `dataset`.
 */
export function buildDatasetEnums(dataset: FlightNetworkDataset): DatasetEnums {
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

function validateSingleAction(
  rawAction: unknown,
  index: number,
  enums: DatasetEnums,
): { ok: true; action: RecoveryAction } | { ok: false; failure: ValidationFailure } {
  const position = `Action #${index + 1}`;
  if (!isPlainObject(rawAction)) {
    return { ok: false, failure: validationFail('INVALID_ACTION', `${position} must be an object.`) };
  }

  switch (rawAction['type']) {
    case 'SWAP_SPARE': {
      const spareTail = rawAction['spareTail'];
      const flightId = rawAction['flightId'];
      if (typeof spareTail !== 'string' || !enums.spareTails.has(spareTail)) {
        return {
          ok: false,
          failure: validationFail('INVALID_ACTION', `${position} references an unknown spare aircraft tail.`),
        };
      }
      if (typeof flightId !== 'string' || !enums.flightIds.has(flightId)) {
        return {
          ok: false,
          failure: validationFail('INVALID_ACTION', `${position} references an unknown flight ID.`),
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
          failure: validationFail('INVALID_ACTION', `${position} references an unknown aircraft tail.`),
        };
      }
      const maxLegs = enums.tailLegCounts.get(tailId) ?? 0;
      if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > maxLegs) {
        return {
          ok: false,
          failure: validationFail(
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
          failure: validationFail('INVALID_ACTION', `${position} references an unknown flight ID.`),
        };
      }
      return { ok: true, action: { type: 'CANCEL_LOOP', firstFlightId, lastFlightId } };
    }

    case 'HOLD_CONNECTION': {
      const connectionId = rawAction['connectionId'];
      if (typeof connectionId !== 'string' || !enums.connectionIds.has(connectionId)) {
        return {
          ok: false,
          failure: validationFail('INVALID_ACTION', `${position} references an unknown connection ID.`),
        };
      }
      return { ok: true, action: { type: 'HOLD_CONNECTION', connectionId } };
    }

    default:
      return {
        ok: false,
        failure: validationFail('INVALID_ACTION', `${position} has an unsupported recovery action type.`),
      };
  }
}

/**
 * Validate and strip unknown fields from an array of recovery actions against `enums`.
 */
export function validateRecoveryActions(
  rawActions: unknown,
  enums: DatasetEnums,
  maxActions: number,
): { ok: true; actions: RecoveryAction[] } | { ok: false; failure: ValidationFailure } {
  if (!Array.isArray(rawActions)) {
    return { ok: false, failure: validationFail('INVALID_ACTIONS', 'Actions must be provided as an array.') };
  }
  if (rawActions.length > maxActions) {
    return {
      ok: false,
      failure: validationFail('TOO_MANY_ACTIONS', `At most ${maxActions} recovery actions are allowed per request.`),
    };
  }

  const actions: RecoveryAction[] = [];
  for (let i = 0; i < rawActions.length; i++) {
    const result = validateSingleAction(rawActions[i], i, enums);
    if (!result.ok) {
      return result;
    }
    actions.push(result.action);
  }
  return { ok: true, actions };
}
