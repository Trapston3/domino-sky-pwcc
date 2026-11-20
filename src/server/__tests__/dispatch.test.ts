import { ThinkingLevel, type Content, type GenerateContentParameters, type GenerateContentResponse } from '@google/genai';
import { beforeEach, describe, expect, it } from 'vitest';
import dispatchHandler, { config as dispatchConfig, type DispatchResponse } from '../../../api/dispatch.js';
import { FLIGHT_NETWORK } from '../../data/flightNetwork.js';
import {
  AI_UNAVAILABLE_NOTICE,
  handleDispatch,
  resetDefaultDispatchRateLimiter,
  type DispatchSuccessBody,
} from '../dispatchCore.js';
import { SlidingWindowRateLimiter } from '../rateLimit.js';
import { MAX_BODY_BYTES } from '../validate.js';
import { createVertexClientFromEnv, resolveVertexModel } from '../vertexClient.js';
import { executeDispatchTool } from '../vertexTools.js';

function basePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mode: 'brief',
    closure: { airport: 'BOM', start: '07:30', end: '09:00' },
    actions: [],
    objective: 'compliance',
    ...overrides,
  };
}

function createMockRes(): { res: DispatchResponse; getStatus: () => number; getBody: () => unknown; headers: Record<string, string> } {
  let status = 200;
  let body: unknown;
  const headers: Record<string, string> = {};
  const res: DispatchResponse = {
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
      return res;
    },
    status(code: number) {
      status = code;
      return res;
    },
    json(payload: unknown) {
      body = payload;
      return res;
    },
  };
  return { res, getStatus: () => status, getBody: () => body, headers };
}

function makeTextResponse(text: string): GenerateContentResponse {
  return {
    text,
    candidates: [{ content: { role: 'model', parts: [{ text }] } }],
  } as GenerateContentResponse;
}

describe('Phase 3 Dispatch & Degradation Matrix', () => {
  beforeEach(() => {
    resetDefaultDispatchRateLimiter();
  });

  it('Row 1 (No credentials): resolves null client and returns DETERMINISTIC ENGINE briefing', async () => {
    expect(createVertexClientFromEnv({})).toBeNull();
    expect(resolveVertexModel({})).toBe('gemini-3.8-flash');
    expect(resolveVertexModel({ VERTEX_MODEL: 'gemini-3.8-pro' })).toBe('gemini-3.8-pro');

    const b64 = Buffer.from(JSON.stringify({ project_id: 'demo-proj', client_email: 'a@b.c', private_key: 'k' })).toString('base64');
    expect(createVertexClientFromEnv({ GOOGLE_VERTEX_API_KEY: 'key-1', GCP_SERVICE_ACCOUNT_B64: b64 })?.authMode).toBe('api_key');
    expect(createVertexClientFromEnv({ GCP_SERVICE_ACCOUNT_B64: b64 })?.authMode).toBe('service_account');

    const res = await handleDispatch(basePayload(), { env: {} });
    expect(res.status).toBe(200);
    const body = res.body as DispatchSuccessBody;
    expect(body.source).toBe('DETERMINISTIC ENGINE');
    expect(body.degraded).toBe(false);
    expect(body.summary.lateFlights).toBe(16);
    expect(body.summary.totalDelayMin).toBe(755);
    expect(body.text).toContain('BOM');
  });

  it('Row 2 (Model/API error or timeout): retries once, drops rejected thinkingConfig, then degrades gracefully', async () => {
    const calls2a: GenerateContentParameters[] = [];
    const res2a = await handleDispatch(basePayload(), {
      model: 'gemini-3.8-flash',
      vertexClient: {
        async generateContent(params) {
          calls2a.push(params);
          if (calls2a.length === 1) throw new Error('Invalid argument: thinkingConfig / thinkingLevel is not supported.');
          return makeTextResponse('BOM ground stop delays 16 flights for 755m.');
        },
      },
    });
    expect(res2a.status).toBe(200);
    expect(calls2a).toHaveLength(2);
    expect(calls2a[0]?.config?.thinkingConfig).toEqual({ thinkingLevel: ThinkingLevel.LOW });
    expect(calls2a[1]?.config?.thinkingConfig).toBeUndefined();
    expect((res2a.body as DispatchSuccessBody).source).toBe('VERTEX AI · gemini-3.8-flash');
    expect((res2a.body as DispatchSuccessBody).degraded).toBe(false);

    let attempts2b = 0;
    const res2b = await handleDispatch(basePayload(), {
      vertexClient: {
        async generateContent() {
          attempts2b += 1;
          throw new Error('503 Service Unavailable');
        },
      },
    });
    expect(attempts2b).toBe(2);
    expect(res2b.status).toBe(200);
    const body2b = res2b.body as DispatchSuccessBody;
    expect(body2b.source).toBe('DETERMINISTIC ENGINE');
    expect(body2b.degraded).toBe(true);
    expect(body2b.notice).toBe(AI_UNAVAILABLE_NOTICE);
    expect(body2b.summary.lateFlights).toBe(16);
  });

  it('Row 3 (Invalid input & zero-trust): returns 400 on bad input/>8KB/invalid plan and strips forged metrics', async () => {
    const badAirport = await handleDispatch(basePayload({ closure: { airport: 'FAKE', start: '07:30', end: '09:00' } }), { env: {} });
    expect(badAirport).toMatchObject({ status: 400, body: { code: 'INVALID_AIRPORT' } });

    const tooLarge = await handleDispatch(basePayload(), { env: {}, rawByteLength: MAX_BODY_BYTES + 1 });
    expect(tooLarge).toMatchObject({ status: 400, body: { code: 'BODY_TOO_LARGE' } });

    const wrongHubPlan = await handleDispatch(
      basePayload({ actions: [{ type: 'SWAP_SPARE', spareTail: 'VT-DS17', flightId: 'DS0101' }] }),
      { env: {} },
    );
    expect(wrongHubPlan).toMatchObject({ status: 400, body: { code: 'SPARE_WRONG_HUB' } });

    const forged = await handleDispatch(
      basePayload({ lateFlights: 0, totalDelayMin: 0, summary: { lateFlights: 0, totalDelayMin: 0, strandedPax: 0 } }),
      { env: {} },
    );
    expect(forged.status).toBe(200);
    expect((forged.body as DispatchSuccessBody).summary.lateFlights).toBe(16);
    expect((forged.body as DispatchSuccessBody).summary.totalDelayMin).toBe(755);
  });

  it('Row 4 (Rate limited): allows 20 requests/min/IP and rejects 21st with 429', async () => {
    const limiter = new SlidingWindowRateLimiter();
    const t0 = 1_700_000_000_000;
    for (let i = 0; i < 20; i++) {
      const okRes = await handleDispatch(basePayload(), { env: {}, rateLimiter: limiter, clientIp: '192.0.2.9', now: t0 + i * 50 });
      expect(okRes.status).toBe(200);
    }
    const blocked = await handleDispatch(basePayload(), { env: {}, rateLimiter: limiter, clientIp: '192.0.2.9', now: t0 + 2000 });
    expect(blocked.status).toBe(429);
    expect(blocked.headers?.['Retry-After']).toBeDefined();
    expect(blocked.body).toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('preserves candidate.content thoughtSignature unchanged, echoes functionCall.id, and handles tool errors', async () => {
    const round1Content: Content = {
      role: 'model',
      parts: [
        { text: 'Checking BLR recovery options...', thought: true, thoughtSignature: 'opaque-sig-xyz-987' },
        { functionCall: { id: 'fc-inspect-1', name: 'inspect_flight', args: { flight_id: 'DS0802' } } },
        {
          functionCall: {
            id: 'fc-sim-valid',
            name: 'simulate_custom_actions',
            args: { actions: [{ type: 'SWAP_SPARE', spareTail: 'VT-DS17', flightId: 'DS0802' }] },
          },
        },
        { functionCall: { id: 'fc-compare', name: 'compare_objectives', args: {} } },
      ],
    };

    const round2Content: Content = {
      role: 'model',
      parts: [
        { text: 'Testing invalid hub swap...', thought: true, thoughtSignature: 'opaque-sig-round-2' },
        {
          functionCall: {
            id: 'fc-sim-invalid',
            name: 'simulate_custom_actions',
            args: { actions: [{ type: 'SWAP_SPARE', spareTail: 'VT-DS18', flightId: 'DS0802' }] },
          },
        },
      ],
    };

    const capturedSnapshots: Content[][] = [];
    const capturedLevels: Array<ThinkingLevel | undefined> = [];

    const res = await handleDispatch(
      {
        mode: 'ask',
        closure: { airport: 'BLR', start: '13:00', end: '14:30' },
        actions: [],
        objective: 'compliance',
        question: 'How do we clear CR08 on BLR closure?',
      },
      {
        model: 'gemini-3.8-flash',
        vertexClient: {
          async generateContent(params) {
            const history = params.contents as Content[];
            capturedSnapshots.push([...history]);
            capturedLevels.push(params.config?.thinkingConfig?.thinkingLevel);
            if (capturedSnapshots.length === 1) return { candidates: [{ content: round1Content }] } as GenerateContentResponse;
            if (capturedSnapshots.length === 2) return { candidates: [{ content: round2Content }] } as GenerateContentResponse;
            return makeTextResponse('Swap VT-DS17 onto DS0802 to clear CR08 (reduces delay to 175m, breaks CX17 for 23 pax).');
          },
        },
      },
    );

    expect(res.status).toBe(200);
    const body = res.body as DispatchSuccessBody;
    expect(body.source).toBe('VERTEX AI · gemini-3.8-flash');
    expect(body.toolRoundsUsed).toBe(2);
    expect(capturedLevels[0]).toBe(ThinkingLevel.MEDIUM);

    const round2History = capturedSnapshots[1]!;
    expect(round2History[1]).toBe(round1Content);
    expect(round2History[1]?.parts?.[0]?.thoughtSignature).toBe('opaque-sig-xyz-987');

    const round2ToolResParts = round2History[2]?.parts ?? [];
    expect(round2ToolResParts.map((p) => p.functionResponse?.id)).toEqual(['fc-inspect-1', 'fc-sim-valid', 'fc-compare']);
    expect(round2ToolResParts[1]?.functionResponse?.response).toHaveProperty('output');

    const round3History = capturedSnapshots[2]!;
    expect(round3History[3]).toBe(round2Content);
    const invalidToolPart = round3History[4]?.parts?.[0]?.functionResponse;
    expect(invalidToolPart?.id).toBe('fc-sim-invalid');
    expect(invalidToolPart?.response).toEqual({
      error: expect.objectContaining({ ok: false, code: 'SPARE_WRONG_HUB' }),
    });
  });

  it('caps tool calls at MAX_TOOL_ROUNDS = 4 and falls back deterministically if no answer produced', async () => {
    let calls = 0;
    const res = await handleDispatch(basePayload({ mode: 'ask', question: 'Loop forever on tools' }), {
      vertexClient: {
        async generateContent() {
          calls += 1;
          return {
            candidates: [
              { content: { role: 'model', parts: [{ functionCall: { id: `loop-${calls}`, name: 'compare_objectives', args: {} } }] } },
            ],
          } as GenerateContentResponse;
        },
      },
    });
    expect(calls).toBe(10);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ source: 'DETERMINISTIC ENGINE', degraded: true, notice: AI_UNAVAILABLE_NOTICE });
  });

  it('validates unknown tools in executeDispatchTool and tests api/dispatch.ts HTTP handler', async () => {
    const baseSim = await handleDispatch(basePayload(), { env: {} });
    const unknownTool = executeDispatchTool('non_existent', {}, FLIGHT_NETWORK, null, [], {
      ok: true,
      closure: null,
      actions: [],
      flights: [],
      connections: [],
      crews: [],
      surge: null,
      summary: (baseSim.body as DispatchSuccessBody).summary,
      passesUsed: 1,
    });
    expect(unknownTool).toEqual({ ok: false, code: 'INVALID_ACTION', reason: 'Unsupported tool "non_existent".' });
    expect(dispatchConfig).toEqual({ maxDuration: 30 });

    const getMock = createMockRes();
    await dispatchHandler({ method: 'GET' }, getMock.res);
    expect(getMock.getStatus()).toBe(405);
    expect(getMock.headers['allow']).toBe('POST');

    const postMock = createMockRes();
    await dispatchHandler(
      { method: 'POST', body: JSON.stringify(basePayload()), headers: { 'x-forwarded-for': '198.51.100.12' } },
      postMock.res,
      { env: {} },
    );
    expect(postMock.getStatus()).toBe(200);
    expect((postMock.getBody() as DispatchSuccessBody).source).toBe('DETERMINISTIC ENGINE');

    const badJsonMock = createMockRes();
    await dispatchHandler({ method: 'POST', body: '{bad-json' }, badJsonMock.res, { env: {} });
    expect(badJsonMock.getStatus()).toBe(400);
    expect(badJsonMock.getBody()).toMatchObject({ code: 'INVALID_JSON' });
  });
});
