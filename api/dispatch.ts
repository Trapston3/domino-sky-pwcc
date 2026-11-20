import {
  extractClientIp,
  handleDispatch,
  type HandleDispatchOptions,
} from '../src/server/dispatchCore.js';
import { MAX_BODY_BYTES } from '../src/server/validate.js';

/** Vercel serverless function configuration (30s max duration). */
export const config = { maxDuration: 30 };

export interface DispatchRequest {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
  socket?: { remoteAddress?: string };
  [Symbol.asyncIterator]?: () => AsyncIterator<Uint8Array | string>;
}

export interface DispatchResponse {
  statusCode?: number;
  setHeader?: (name: string, value: string) => unknown;
  end?: (chunk?: string) => unknown;
  status?: (code: number) => DispatchResponse;
  json?: (payload: unknown) => unknown;
}

function sendJson(
  res: DispatchResponse,
  statusCode: number,
  payload: unknown,
  headers?: Record<string, string>,
): void {
  if (typeof res.setHeader === 'function') {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (headers) {
      for (const [key, value] of Object.entries(headers)) {
        res.setHeader(key, value);
      }
    }
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

type BodyReadOutcome =
  | { ok: true; body: unknown; byteLength?: number }
  | { ok: false; status: 400; error: string; code: 'BODY_TOO_LARGE' | 'INVALID_JSON' };

async function readRequestBody(req: DispatchRequest): Promise<BodyReadOutcome> {
  const headerLenRaw = req.headers?.['content-length'];
  const headerLenStr = Array.isArray(headerLenRaw) ? headerLenRaw[0] : headerLenRaw;
  const declaredBytes =
    typeof headerLenStr === 'string' && /^\d+$/.test(headerLenStr.trim())
      ? Number(headerLenStr.trim())
      : undefined;

  if (declaredBytes !== undefined && declaredBytes > MAX_BODY_BYTES) {
    return {
      ok: false,
      status: 400,
      error: `Request body exceeds the ${MAX_BODY_BYTES}-byte limit.`,
      code: 'BODY_TOO_LARGE',
    };
  }

  if (req.body !== undefined) {
    if (typeof req.body === 'string') {
      const byteLength = Buffer.byteLength(req.body, 'utf8');
      if (byteLength > MAX_BODY_BYTES) {
        return {
          ok: false,
          status: 400,
          error: `Request body exceeds the ${MAX_BODY_BYTES}-byte limit.`,
          code: 'BODY_TOO_LARGE',
        };
      }
      try {
        return { ok: true, body: JSON.parse(req.body), byteLength };
      } catch {
        return {
          ok: false,
          status: 400,
          error: 'Request body must be valid JSON.',
          code: 'INVALID_JSON',
        };
      }
    }

    if (Buffer.isBuffer(req.body) || req.body instanceof Uint8Array) {
      const buf = Buffer.from(req.body);
      if (buf.byteLength > MAX_BODY_BYTES) {
        return {
          ok: false,
          status: 400,
          error: `Request body exceeds the ${MAX_BODY_BYTES}-byte limit.`,
          code: 'BODY_TOO_LARGE',
        };
      }
      try {
        return {
          ok: true,
          body: JSON.parse(buf.toString('utf8')),
          byteLength: buf.byteLength,
        };
      } catch {
        return {
          ok: false,
          status: 400,
          error: 'Request body must be valid JSON.',
          code: 'INVALID_JSON',
        };
      }
    }

    return {
      ok: true,
      body: req.body,
      ...(declaredBytes !== undefined ? { byteLength: declaredBytes } : {}),
    };
  }

  if (typeof req[Symbol.asyncIterator] !== 'function') {
    return {
      ok: false,
      status: 400,
      error: 'Request body must be valid JSON.',
      code: 'INVALID_JSON',
    };
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req as AsyncIterable<Uint8Array | string>) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk);
    totalBytes += buf.byteLength;
    if (totalBytes > MAX_BODY_BYTES) {
      return {
        ok: false,
        status: 400,
        error: `Request body exceeds the ${MAX_BODY_BYTES}-byte limit.`,
        code: 'BODY_TOO_LARGE',
      };
    }
    chunks.push(buf);
  }

  const rawText = Buffer.concat(chunks).toString('utf8');
  if (!rawText.trim()) {
    return {
      ok: false,
      status: 400,
      error: 'Request body must be a non-empty JSON object.',
      code: 'INVALID_JSON',
    };
  }

  try {
    return { ok: true, body: JSON.parse(rawText), byteLength: totalBytes };
  } catch {
    return {
      ok: false,
      status: 400,
      error: 'Request body must be valid JSON.',
      code: 'INVALID_JSON',
    };
  }
}

/**
 * Serverless POST `/api/dispatch` handler for zero-trust network simulation,
 * recovery recommendation ranking, and Vertex AI / deterministic briefing.
 */
export default async function handler(
  req: DispatchRequest,
  res: DispatchResponse,
  overrides: HandleDispatchOptions = {},
): Promise<void> {
  if (req.method !== 'POST') {
    if (typeof res.setHeader === 'function') {
      res.setHeader('Allow', 'POST');
    }
    sendJson(res, 405, {
      error: 'Method not allowed. Use POST.',
      code: 'METHOD_NOT_ALLOWED',
    });
    return;
  }

  const contentTypeRaw = Object.entries(req.headers ?? {}).find(
    ([name]) => name.toLowerCase() === 'content-type',
  )?.[1];
  const contentTypes = Array.isArray(contentTypeRaw)
    ? contentTypeRaw
    : contentTypeRaw !== undefined
      ? [contentTypeRaw]
      : [];
  if (contentTypes.some((value) => !value.toLowerCase().includes('application/json'))) {
    sendJson(res, 400, {
      error: 'Content-Type must be application/json.',
      code: 'INVALID_CONTENT_TYPE',
    });
    return;
  }

  try {
    const readOutcome = await readRequestBody(req);
    if (!readOutcome.ok) {
      sendJson(res, readOutcome.status, {
        error: readOutcome.error,
        code: readOutcome.code,
      });
      return;
    }

    const clientIp =
      overrides.clientIp ?? extractClientIp(req.headers, req.socket?.remoteAddress);
    const result = await handleDispatch(readOutcome.body, {
      ...overrides,
      clientIp,
      ...(overrides.rawByteLength !== undefined
        ? { rawByteLength: overrides.rawByteLength }
        : readOutcome.byteLength !== undefined
          ? { rawByteLength: readOutcome.byteLength }
          : {}),
    });

    sendJson(res, result.status, result.body, result.headers);
  } catch {
    sendJson(res, 500, {
      error: 'Internal server error.',
      code: 'INTERNAL_ERROR',
    });
  }
}
