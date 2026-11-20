import type { IncomingMessage, ServerResponse } from 'node:http';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

interface VercelLikeResponse extends ServerResponse {
  status: (code: number) => VercelLikeResponse;
  json: (payload: unknown) => VercelLikeResponse;
}

function attachVercelHelpers(res: ServerResponse): VercelLikeResponse {
  const vRes = res as VercelLikeResponse;
  vRes.status = (code: number) => {
    res.statusCode = code;
    return vRes;
  };
  vRes.json = (payload: unknown) => {
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    res.end(JSON.stringify(payload));
    return vRes;
  };
  return vRes;
}

function localApiPlugin(): Plugin {
  return {
    name: 'domino-sky-local-api',
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        const urlPath = (req.url ?? '').split('?')[0];
        if (urlPath !== '/api/ping' && urlPath !== '/api/dispatch') {
          next();
          return;
        }
        try {
          const modulePath = urlPath === '/api/ping' ? '/api/ping.ts' : '/api/dispatch.ts';
          const mod = await server.ssrLoadModule(modulePath);
          const handler = mod.default as (r: IncomingMessage, s: VercelLikeResponse) => Promise<void> | void;
          await handler(req, attachVercelHelpers(res));
        } catch {
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ error: 'Internal server error', code: 'INTERNAL_ERROR' }));
          }
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), localApiPlugin()],
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
  },
});
