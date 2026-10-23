// Backend for the Polotno + Lulu demo.
//
// The editor runs in the browser, so it cannot hold the Lulu credentials.
// This server holds them and exposes:
//
//   GET /health
//   POST /lulu/check-cover
//
// Env:
//   LULU_CLIENT_KEY, LULU_CLIENT_SECRET
//   PUBLIC_URL      this server's public URL; the provider downloads print files from it
//   ALLOWED_ORIGINS comma-separated, defaults to localhost:5173

import http from 'node:http';
import { randomUUID } from 'node:crypto';

const env = process.env;
const PORT = Number(env.PORT || 8787);
const PUBLIC_URL = (env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const ALLOWED_ORIGINS = (
  env.ALLOWED_ORIGINS ||
  'http://localhost:5173'
).split(',');

const MAX_BODY = 25 * 1024 * 1024;
const FILE_TTL_MS = 10 * 60 * 1000;

// --- helpers ------------------------------------------------------------------

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(base, token, path, { method = 'GET', body, headers = {} } = {}) {
  // A provider with its own auth header passes Authorization: undefined.
  const allHeaders = Object.fromEntries(
    Object.entries({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers }).filter(
      ([, v]) => v !== undefined
    )
  );
  const res = await fetch(base + path, {
    method,
    headers: allHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const detail = json?.error?.message || json?.message || json?.result || text;
    throw new HttpError(502, `${method} ${path} failed (${res.status}): ${detail}`);
  }
  return json;
}

// --- temporary file hosting (Lulu downloads print files by URL) -----------

const files = new Map();

const FILE_TYPES = { png: 'image/png', pdf: 'application/pdf' };

function hostFile(base64, ext = 'png') {
  const id = randomUUID();
  files.set(id, { data: Buffer.from(base64, 'base64'), ext, expires: Date.now() + FILE_TTL_MS });
  return `${PUBLIC_URL}/files/${id}.${ext}`;
}

setInterval(() => {
  const now = Date.now();
  for (const [id, f] of files) if (f.expires < now) files.delete(id);
}, 60 * 1000).unref();

// --- Lulu -----------------------------------------------------------------------

const LULU_API = (env.LULU_API || 'https://api.sandbox.lulu.com').replace(/\/$/, '');

// Client-credentials token, reused until shortly before it expires.
let luluToken = null;
async function luluAuth() {
  if (!env.LULU_CLIENT_KEY || !env.LULU_CLIENT_SECRET) {
    throw new HttpError(503, 'LULU_CLIENT_KEY and LULU_CLIENT_SECRET are not set');
  }
  if (luluToken && luluToken.expires > Date.now()) return luluToken.value;
  const basic = Buffer.from(`${env.LULU_CLIENT_KEY}:${env.LULU_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`${LULU_API}/auth/realms/glasstree/protocol/openid-connect/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(502, `Lulu auth failed (${res.status})`);
  luluToken = { value: json.access_token, expires: Date.now() + (json.expires_in - 60) * 1000 };
  return luluToken.value;
}

const lulu = async (path, opts) => api(LULU_API, await luluAuth(), path, opts);

// Paperback pod_package_id: trim + color + quality + binding + paper + finish.
const LULU_PAPERS = {
  'bw-white': 'BW.STD.PB.060UW444.MXX',
  'bw-cream': 'BW.STD.PB.060UC444.MXX',
  color: 'FC.STD.PB.080CW444.MXX',
};
function luluPackage(trimWidth, trimHeight, paper) {
  const code = LULU_PAPERS[paper];
  if (!code) throw new HttpError(400, `Unknown paper "${paper}"`);
  const dim = (inches) => String(Math.round(inches * 100)).padStart(4, '0');
  return `${dim(trimWidth)}X${dim(trimHeight)}.${code}`;
}

async function luluCheckCover(body) {
  // Polotno's PDF data URL carries a filename parameter before base64.
  const pdf = String(body?.pdf || '').replace(/^data:application\/pdf[^,]*,/, '');
  if (!pdf.startsWith('JVBER')) throw new HttpError(400, 'pdf is not a PDF');
  const pageCount = Math.round(Number(body.pageCount));
  if (!(pageCount > 0)) throw new HttpError(400, 'pageCount is required');
  const pod_package_id = luluPackage(Number(body.trimWidth), Number(body.trimHeight), body.paper || 'bw-white');

  const dimensionsBody = { pod_package_id, interior_page_count: pageCount, unit: 'inch' };
  const expected = await lulu('/cover-dimensions/', { method: 'POST', body: dimensionsBody });

  const validateBody = { source_url: hostFile(pdf, 'pdf'), pod_package_id, interior_page_count: pageCount };
  let check = await lulu('/validate-cover/', { method: 'POST', body: validateBody });

  // Lulu normalizes the file asynchronously: the create response has no
  // status yet, then NORMALIZING, then NORMALIZED or ERROR. Poll until it
  // settles.
  const started = Date.now();
  const pending = (c) => !c.status || c.status === 'NORMALIZING';
  while (pending(check) && Date.now() - started < 90 * 1000) {
    await sleep(3000);
    check = await lulu(`/validate-cover/${check.id}/`);
  }

  return {
    pod_package_id,
    expected,
    validation: { status: check.status, errors: check.errors || [] },
    requests: [
      {
        title: 'Ask Lulu for the cover size',
        endpoint: `POST ${LULU_API}/cover-dimensions/`,
        body: dimensionsBody,
        response: expected,
      },
      {
        title: 'Validate the cover PDF',
        endpoint: `POST ${LULU_API}/validate-cover/`,
        body: validateBody,
        response: { status: check.status, errors: check.errors || [] },
      },
    ],
  };
}

// --- rate limit -----------------------------------------------------------------

const hits = new Map();
function rateLimit(ip, limit = 12, windowMs = 60 * 1000) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) throw new HttpError(429, 'Too many requests, try again in a minute');
  recent.push(now);
  hits.set(ip, recent);
}

// --- server ---------------------------------------------------------------------

const routes = {
  'GET /health': async () => ({ ok: true }),
  'POST /lulu/check-cover': (body) => luluCheckCover(body),
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Design too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {});
      } catch {
        reject(new HttpError(400, 'Body is not JSON'));
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, PUBLIC_URL);
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.writeHead(204).end();

  const file = url.pathname.match(/^\/files\/([0-9a-f-]+)\.(png|pdf)$/);
  if (req.method === 'GET' && file) {
    const f = files.get(file[1]);
    if (!f || f.ext !== file[2]) return res.writeHead(404).end();
    return res.writeHead(200, { 'Content-Type': FILE_TYPES[f.ext] }).end(f.data);
  }

  const route = routes[`${req.method} ${url.pathname}`];
  try {
    if (!route) throw new HttpError(404, 'Not found');
    if (req.method === 'POST') {
      const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '')
        .split(',')[0]
        .trim();
      rateLimit(ip);
    }
    const body = req.method === 'POST' ? await readBody(req) : null;
    const result = await route(body, url.searchParams);
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error(req.method, url.pathname, e.message);
    res
      .writeHead(status, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ error: e.message }));
  }
});

server.listen(PORT, () => console.log(`pod-proxy listening on ${PORT}`));
