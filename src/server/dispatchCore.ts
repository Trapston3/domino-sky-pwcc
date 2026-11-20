import { FLIGHT_NETWORK } from '../data/flightNetwork.js';
import { optimizeRecovery, simulateNetwork } from '../engine/index.js';
import type {
  FlightNetworkDataset,
  Objective,
  RecoveryRecommendation,
  SimulationSummary,
} from '../engine/types.js';
import { buildDeterministicBriefing } from './briefing.js';
import { SlidingWindowRateLimiter } from './rateLimit.js';
import {
  validateDispatchRequest,
  type DispatchMode,
} from './validate.js';
import {
  createVertexClientFromEnv,
  resolveVertexModel,
  runVertexDispatch,
  type EnvRecord,
  type VertexGenerateClient,
} from './vertexClient.js';

export const AI_UNAVAILABLE_NOTICE =
  'AI unavailable — showing deterministic engine briefing.';

export interface DispatchSuccessBody {
  source: 'DETERMINISTIC ENGINE' | `VERTEX AI · ${string}`;
  mode: DispatchMode;
  objective: Objective;
  text: string;
  degraded: boolean;
  notice?: string;
  toolRoundsUsed?: number;
  summary: SimulationSummary;
  baselineSummary: SimulationSummary;
  recommendations: RecoveryRecommendation[];
}

export interface DispatchErrorBody {
  error: string;
  code: string;
}

export interface DispatchHttpResult {
  status: 200 | 400 | 405 | 429 | 500;
  headers?: Record<string, string>;
  body: DispatchSuccessBody | DispatchErrorBody;
}

export interface HandleDispatchOptions {
  dataset?: FlightNetworkDataset;
  clientIp?: string;
  now?: number;
  rawByteLength?: number;
  rateLimiter?: SlidingWindowRateLimiter;
  env?: EnvRecord;
  vertexClient?: VertexGenerateClient | null;
  model?: string;
  timeoutMs?: number;
}

const defaultRateLimiter = new SlidingWindowRateLimiter();

/**
 * Reset the shared module-level rate limiter (used in unit tests).
 */
export function resetDefaultDispatchRateLimiter(ip?: string): void {
  defaultRateLimiter.reset(ip);
}

/**
 * Extract the client IP address from common proxy headers or socket metadata.
 */
export function extractClientIp(
  headers?: Record<string, string | string[] | undefined>,
  remoteAddress?: string,
): string {
  const forwarded = headers?.['x-forwarded-for'];
  const firstForwarded = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (typeof firstForwarded === 'string' && firstForwarded.trim().length > 0) {
    const firstHop = firstForwarded.split(',')[0]?.trim();
    if (firstHop) return firstHop;
  }

  const realIp = headers?.['x-real-ip'];
  const firstReal = Array.isArray(realIp) ? realIp[0] : realIp;
  if (typeof firstReal === 'string' && firstReal.trim().length > 0) {
    return firstReal.trim();
  }

  if (typeof remoteAddress === 'string' && remoteAddress.trim().length > 0) {
    return remoteAddress.trim();
  }

  return 'unknown';
}

/**
 * Execute the zero-trust dispatch pipeline:
 * 1. Per-IP sliding-window rate limit check (20 req/min/IP).
 * 2. Strict input schema, size (<= 8 KB), and dataset-derived enum validation.
 * 3. Server-side deterministic engine recomputation of baseline, active, and optimizer states.
 * 4. Vertex AI narration/tool-loop with 1 retry + deterministic fallback on error or missing credentials.
 */
export async function handleDispatch(
  rawBody: unknown,
  options: HandleDispatchOptions = {},
): Promise<DispatchHttpResult> {
  const dataset = options.dataset ?? FLIGHT_NETWORK;
  const limiter = options.rateLimiter ?? defaultRateLimiter;
  const clientIp = options.clientIp ?? 'unknown';

  const rateResult = limiter.check(clientIp, options.now);
  if (!rateResult.allowed) {
    return {
      status: 429,
      headers: { 'Retry-After': String(rateResult.retryAfterSec) },
      body: {
        error: 'Rate limit exceeded (20 requests per minute). Please slow down.',
        code: 'RATE_LIMITED',
      },
    };
  }

  const validation = validateDispatchRequest(rawBody, dataset, options.rawByteLength);
  if (!validation.ok) {
    return {
      status: 400,
      body: {
        error: validation.error,
        code: validation.code,
      },
    };
  }

  const { mode, closure, actions, objective, question } = validation.data;

  const baselineOutcome = simulateNetwork(dataset, closure, []);
  if (!baselineOutcome.ok) {
    return {
      status: 400,
      body: {
        error: baselineOutcome.reason,
        code: baselineOutcome.code,
      },
    };
  }

  const activeOutcome = simulateNetwork(dataset, closure, actions);
  if (!activeOutcome.ok) {
    return {
      status: 400,
      body: {
        error: activeOutcome.reason,
        code: activeOutcome.code,
      },
    };
  }

  const recommendations = optimizeRecovery(dataset, closure, objective, actions);
  const deterministicText = buildDeterministicBriefing(
    dataset,
    closure,
    actions,
    objective,
    baselineOutcome,
    activeOutcome,
    recommendations,
    question,
  );

  const env = options.env ?? process.env;
  const resolvedAuth =
    options.vertexClient !== undefined
      ? options.vertexClient
        ? {
            client: options.vertexClient,
            model: options.model ?? resolveVertexModel(env),
          }
        : null
      : createVertexClientFromEnv(env);

  if (!resolvedAuth) {
    return {
      status: 200,
      body: {
        source: 'DETERMINISTIC ENGINE',
        mode,
        objective,
        text: deterministicText,
        degraded: false,
        summary: activeOutcome.summary,
        baselineSummary: baselineOutcome.summary,
        recommendations,
      },
    };
  }

  try {
    const vertexOut = await runVertexDispatch({
      mode,
      dataset,
      closure,
      actions,
      objective,
      baselineSim: baselineOutcome,
      activeSim: activeOutcome,
      recommendations,
      ...(question !== undefined ? { question } : {}),
      env,
      client: resolvedAuth.client,
      model: resolvedAuth.model,
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    });

    if (!vertexOut) {
      return {
        status: 200,
        body: {
          source: 'DETERMINISTIC ENGINE',
          mode,
          objective,
          text: deterministicText,
          degraded: false,
          summary: activeOutcome.summary,
          baselineSummary: baselineOutcome.summary,
          recommendations,
        },
      };
    }

    return {
      status: 200,
      body: {
        source: `VERTEX AI · ${vertexOut.model}`,
        mode,
        objective,
        text: vertexOut.text,
        degraded: false,
        toolRoundsUsed: vertexOut.toolRoundsUsed,
        summary: activeOutcome.summary,
        baselineSummary: baselineOutcome.summary,
        recommendations,
      },
    };
  } catch {
    return {
      status: 200,
      body: {
        source: 'DETERMINISTIC ENGINE',
        mode,
        objective,
        text: deterministicText,
        degraded: true,
        notice: AI_UNAVAILABLE_NOTICE,
        summary: activeOutcome.summary,
        baselineSummary: baselineOutcome.summary,
        recommendations,
      },
    };
  }
}
