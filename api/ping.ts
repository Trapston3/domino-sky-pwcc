import { FLIGHT_NETWORK } from '../src/data/flightNetwork.js';
import { simulateNetwork } from '../src/engine/index.js';

/** Vercel serverless function configuration (10s max duration). */
export const config = { maxDuration: 10 };

export interface PingRequest {
  method?: string;
}

export interface PingResponse {
  statusCode?: number;
  setHeader?: (name: string, value: string) => unknown;
  end?: (chunk?: string) => unknown;
  status?: (code: number) => PingResponse;
  json?: (payload: unknown) => unknown;
}

function sendJson(res: PingResponse, statusCode: number, payload: unknown): void {
  if (typeof res.setHeader === 'function') {
    res.setHeader('Cache-Control', 'no-store');
  }
  if (typeof res.status === 'function') {
    const target = res.status(statusCode);
    if (target && typeof target.json === 'function') {
      target.json(payload);
      return;
    }
    if (typeof res.json === 'function') {
      res.json(payload);
      return;
    }
  }
  res.statusCode = statusCode;
  if (typeof res.setHeader === 'function') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
  }
  if (typeof res.end === 'function') {
    res.end(JSON.stringify(payload));
  }
}

/**
 * Serverless smoke-test handler verifying baseline simulation on GET requests.
 */
export default function handler(req: PingRequest, res: PingResponse): void {
  if (req.method !== 'GET') {
    if (typeof res.setHeader === 'function') {
      res.setHeader('Allow', 'GET');
    }
    sendJson(res, 405, {
      error: 'Method not allowed. Use GET.',
      code: 'METHOD_NOT_ALLOWED',
    });
    return;
  }

  try {
    const sim = simulateNetwork(FLIGHT_NETWORK, null, []);
    if (!sim.ok) {
      sendJson(res, 500, {
        error: 'Baseline simulation failed.',
        code: 'SIMULATION_ERROR',
      });
      return;
    }
    sendJson(res, 200, {
      ok: true,
      flights: sim.summary.totalFlights,
      baselineLate: sim.summary.lateFlights,
    });
  } catch {
    sendJson(res, 500, {
      error: 'Internal server error.',
      code: 'INTERNAL_ERROR',
    });
  }
}
