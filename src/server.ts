/**
 * Tiny HTTP API + static UI server (node:http, no framework).
 *
 *   GET  /api/health      → { ok, service, version, readOnly: true }
 *   GET  /api/tool        → tool schemas (Anthropic / OpenAI / MCP)
 *   POST /api/check       → GuardResult (body: CheckInput or tool-style args)
 *   POST /api/tool-call   → compact tool result for agents (body: tool args)
 *   GET  /*               → static files from dist/ (after `npm run build`)
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANTHROPIC_TOOL, MCP_TOOL, OPENAI_TOOL, toToolResult, toolArgsToInput, type ToolArgs } from './agent/toolSchema.js';
import { checkPayment, ENGINE_VERSION, type CheckOptions } from './guard/engine.js';
import { createFixtureFetch } from './guard/fixtures.js';
import type { CheckInput } from './guard/types.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const MAX_BODY = 64 * 1024;

export interface AppOptions {
  staticDir?: string;
  check?: CheckOptions;
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const data = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'content-type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  res.end(data);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw Object.assign(new Error('body too large'), { status: 413 });
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw Object.assign(new Error('invalid JSON'), { status: 400 });
  }
}

/** Accept both CheckInput ({receiver, amountNear, message}) and tool args ({receiver, amount_near, originating_message}). */
function toInput(body: Record<string, unknown>): CheckInput {
  if ('amount_near' in body || 'originating_message' in body) return toolArgsToInput(body as unknown as ToolArgs);
  return {
    receiver: String(body.receiver ?? body.to ?? ''),
    amountNear: (body.amountNear ?? body.amount ?? '') as string,
    network: body.network === 'mainnet' ? 'mainnet' : 'testnet',
    sender: typeof body.sender === 'string' ? body.sender : undefined,
    memo: typeof body.memo === 'string' ? body.memo : undefined,
    message: typeof body.message === 'string' ? body.message : undefined,
  };
}

async function serveStatic(dir: string, urlPath: string, res: ServerResponse) {
  const root = resolve(dir);
  let rel = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  if (rel.endsWith('/')) rel += 'index.html';
  const file = normalize(join(root, rel));
  if (file !== root && !file.startsWith(root + sep)) return send(res, 403, 'forbidden');
  try {
    const st = await stat(file);
    if (!st.isFile()) throw new Error('not a file');
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'x-content-type-options': 'nosniff' });
    res.end(await readFile(file));
  } catch {
    try {
      const html = await readFile(join(root, 'index.html'));
      res.writeHead(200, { 'content-type': MIME['.html']! });
      res.end(html);
    } catch {
      send(res, 404, 'UI not built. Run `npm run build` (or `npm start`), or use `npm run dev`.');
    }
  }
}

export function createApp(opts: AppOptions = {}): Server {
  return createServer(async (req, res) => {
    const url = req.url ?? '/';
    const path = url.split('?')[0]!;
    try {
      if (req.method === 'OPTIONS') return send(res, 204, '');
      if (path === '/api/health' && req.method === 'GET') {
        return send(res, 200, { ok: true, service: 'financilab-near-payment-guard', version: ENGINE_VERSION, readOnly: true, signs: false });
      }
      if (path === '/api/tool' && req.method === 'GET') {
        return send(res, 200, { anthropic: ANTHROPIC_TOOL, openai: OPENAI_TOOL, mcp: MCP_TOOL });
      }
      if ((path === '/api/check' || path === '/api/tool-call') && req.method === 'POST') {
        const body = await readJson(req);
        if (!body || typeof body !== 'object' || Array.isArray(body)) return send(res, 400, { error: 'expected a JSON object' });
        const input = toInput(body as Record<string, unknown>);
        if (!input.receiver) return send(res, 400, { error: '`receiver` is required' });
        const result = await checkPayment(input, opts.check);
        return send(res, 200, path === '/api/check' ? result : toToolResult(result));
      }
      if (path.startsWith('/api/')) return send(res, 404, { error: 'not found' });
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method not allowed' });
      if (!opts.staticDir) return send(res, 404, 'no static dir');
      return serveStatic(opts.staticDir, path, res);
    } catch (e) {
      const status = (e as { status?: number }).status ?? 500;
      return send(res, status, { error: e instanceof Error ? e.message : String(e) });
    }
  });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT ?? 8787);
  const host = process.env.HOST ?? '127.0.0.1';
  const offline = process.argv.includes('--offline') || process.env.GUARD_OFFLINE === '1';
  const staticDir = fileURLToPath(new URL('../dist', import.meta.url));
  createApp({ staticDir, check: offline ? { fetch: createFixtureFetch() } : {} }).listen(port, host, () => {
    console.log(`FinanciLab Payment Guard on http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
    console.log(`  UI:  http://localhost:${port}/`);
    console.log(`  API: POST http://localhost:${port}/api/check   GET /api/health   GET /api/tool`);
    console.log(`  Mode: ${offline ? 'OFFLINE fixtures' : 'live read-only NEAR RPC'} · no wallet, no keys, nothing is signed`);
  });
}
