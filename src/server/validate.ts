import type {
  ClosureSpec,
  FlightNetworkDataset,
  Objective,
  RecoveryAction,
} from '../engine/types.js';
import {
  buildDatasetEnums,
  isPlainObject,
  validateRecoveryActions,
  validationFail,
  type ValidationFailure,
} from './validateActions.js';

export type { ValidationErrorCode, ValidationFailure } from './validateActions.js';

export const MAX_BODY_BYTES = 8192;
export const MAX_CLOSURE_DURATION_MIN = 240;
export const MAX_ACTIONS = 5;
export const MAX_QUESTION_LENGTH = 300;

const HHMM_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const VALID_MODES = new Set<DispatchMode>(['brief', 'ask']);
const VALID_OBJECTIVES = new Set<Objective>(['compliance', 'passengers', 'delay']);

export type DispatchMode = 'brief' | 'ask';

export interface ValidatedDispatchRequest {
  mode: DispatchMode;
  closure: ClosureSpec | null;
  actions: RecoveryAction[];
  objective: Objective;
  question?: string;
}

export type ValidationResult =
  | { ok: true; data: ValidatedDispatchRequest }
  | ValidationFailure;

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

function checkPayloadSize(raw: unknown, rawByteLength?: number): ValidationFailure | null {
  if (rawByteLength !== undefined) {
    if (typeof rawByteLength !== 'number' || !Number.isFinite(rawByteLength) || rawByteLength < 0) {
      return validationFail('INVALID_PAYLOAD', 'Invalid request content length.');
    }
    if (rawByteLength > MAX_BODY_BYTES) {
      return validationFail('BODY_TOO_LARGE', `Request body exceeds the ${MAX_BODY_BYTES}-byte limit.`);
    }
    return null;
  }

  if (typeof raw === 'string') {
    if (utf8ByteLength(raw) > MAX_BODY_BYTES) {
      return validationFail('BODY_TOO_LARGE', `Request body exceeds the ${MAX_BODY_BYTES}-byte limit.`);
    }
    return validationFail('INVALID_PAYLOAD', 'Request body must be a JSON object.');
  }

  try {
    const serialized = JSON.stringify(raw);
    if (serialized === undefined) {
      return validationFail('INVALID_PAYLOAD', 'Request body must be a JSON object.');
    }
    if (utf8ByteLength(serialized) > MAX_BODY_BYTES) {
      return validationFail('BODY_TOO_LARGE', `Request body exceeds the ${MAX_BODY_BYTES}-byte limit.`);
    }
    return null;
  } catch {
    return validationFail('INVALID_PAYLOAD', 'Request body must be a serializable JSON object.');
  }
}

function validateClosure(
  rawClosure: unknown,
  airportIds: Set<string>,
): { ok: true; closure: ClosureSpec | null } | { ok: false; failure: ValidationFailure } {
  if (rawClosure === null) {
    return { ok: true, closure: null };
  }
  if (!isPlainObject(rawClosure)) {
    return {
      ok: false,
      failure: validationFail('INVALID_CLOSURE', 'Closure must be null or an object with airport, start, and end.'),
    };
  }

  const airport = rawClosure['airport'];
  if (typeof airport !== 'string' || !airportIds.has(airport)) {
    return {
      ok: false,
      failure: validationFail('INVALID_AIRPORT', 'Closure airport must be a valid airport code from the network.'),
    };
  }

  const start = rawClosure['start'];
  const end = rawClosure['end'];
  const startMin = parseHHMM(start);
  const endMin = parseHHMM(end);
  if (startMin === null || endMin === null || typeof start !== 'string' || typeof end !== 'string') {
    return {
      ok: false,
      failure: validationFail('INVALID_TIME', 'Closure start and end times must use 24-hour HH:MM format.'),
    };
  }
  if (startMin >= endMin) {
    return {
      ok: false,
      failure: validationFail('INVALID_CLOSURE_TIME', 'Closure end time must be strictly after start time.'),
    };
  }
  if (endMin - startMin > MAX_CLOSURE_DURATION_MIN) {
    return {
      ok: false,
      failure: validationFail('CLOSURE_TOO_LONG', `Closure duration cannot exceed ${MAX_CLOSURE_DURATION_MIN} minutes.`),
    };
  }

  return { ok: true, closure: { airport, start, end } };
}

function validateQuestion(
  rawQuestion: unknown,
  mode: DispatchMode,
): { ok: true; question?: string } | { ok: false; failure: ValidationFailure } {
  let trimmedQuestion: string | undefined;
  if (rawQuestion !== undefined) {
    if (typeof rawQuestion !== 'string') {
      return { ok: false, failure: validationFail('INVALID_QUESTION', 'Question must be a text string.') };
    }
    const trimmed = rawQuestion.trim();
    if (trimmed.length > MAX_QUESTION_LENGTH) {
      return {
        ok: false,
        failure: validationFail('QUESTION_TOO_LONG', `Question must be ${MAX_QUESTION_LENGTH} characters or fewer.`),
      };
    }
    if (trimmed.length > 0) {
      trimmedQuestion = trimmed;
    }
  }

  if (mode === 'ask' && !trimmedQuestion) {
    return {
      ok: false,
      failure: validationFail('QUESTION_REQUIRED', 'A non-empty question is required when mode is "ask".'),
    };
  }

  return { ok: true, ...(trimmedQuestion !== undefined ? { question: trimmedQuestion } : {}) };
}

/**
 * Zero-trust validator for dispatch API payloads.
 * Derives all allowed enums strictly from `dataset` and strips all unknown fields.
 */
export function validateDispatchRequest(
  raw: unknown,
  dataset: FlightNetworkDataset,
  rawByteLength?: number,
): ValidationResult {
  const sizeError = checkPayloadSize(raw, rawByteLength);
  if (sizeError) {
    return sizeError;
  }
  if (!isPlainObject(raw)) {
    return validationFail('INVALID_PAYLOAD', 'Request body must be a JSON object.');
  }

  const rawMode = raw['mode'];
  if (typeof rawMode !== 'string' || !VALID_MODES.has(rawMode as DispatchMode)) {
    return validationFail('INVALID_MODE', 'Mode must be either "brief" or "ask".');
  }
  const mode = rawMode as DispatchMode;

  const rawObjective = raw['objective'];
  if (typeof rawObjective !== 'string' || !VALID_OBJECTIVES.has(rawObjective as Objective)) {
    return validationFail('INVALID_OBJECTIVE', 'Objective must be "compliance", "passengers", or "delay".');
  }
  const objective = rawObjective as Objective;

  const enums = buildDatasetEnums(dataset);
  const closureResult = validateClosure(raw['closure'], enums.airportIds);
  if (!closureResult.ok) {
    return closureResult.failure;
  }

  const actionsResult = validateRecoveryActions(raw['actions'], enums, MAX_ACTIONS);
  if (!actionsResult.ok) {
    return actionsResult.failure;
  }

  const questionResult = validateQuestion(raw['question'], mode);
  if (!questionResult.ok) {
    return questionResult.failure;
  }

  return {
    ok: true,
    data: {
      mode,
      closure: closureResult.closure,
      actions: actionsResult.actions,
      objective,
      ...(questionResult.question !== undefined ? { question: questionResult.question } : {}),
    },
  };
}
