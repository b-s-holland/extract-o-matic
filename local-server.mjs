// local-server.mjs
// Local dev server. Serves index.html and assets/, and handles POST
// /api/extract using the same logic Vercel will run later -- one
// endpoint now, running the whole pipeline in one request. Needs Node
// 18+ and `npm install` run once (for @hyzyla/pdfium and pngjs).
//
// Run it with:   node local-server.mjs
// Then open:     http://localhost:3000

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPipeline } from './lib/translate-core.js';
import { parseMultipart } from './lib/multipart.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// --- tiny .env.local loader, same pattern as Culty Ipsum's ---
async function loadEnvFile() {
  try {
    const contents = await fs.readFile(path.join(__dirname, '.env.local'), 'utf8');
    for (const line of contents.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // no .env.local yet -- fine, just means OPENAI_API_KEY needs to
    // already be set in the shell environment.
  }
}

const MIME = {
  '.html': 'text/html',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json'
};

async function serveStatic(req, res) {
  let urlPath = req.url === '/' ? '/index.html' : req.url;
  urlPath = urlPath.split('?')[0];
  const filePath = path.join(__dirname, urlPath);

  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

async function handleExtract(req, res) {
  try {
    const buffer = await readRawBody(req);
    const contentType = req.headers['content-type'] || '';
    const { fields, files } = parseMultipart(buffer, contentType);

    const result = await runPipeline({
      pageFrom: fields.pageFrom,
      pageTo: fields.pageTo,
      sectionTitle: fields.sectionTitle,
      fileName: files.pdf ? files.pdf.filename : undefined,
      pdfBuffer: files.pdf ? files.pdf.data : undefined
    });

    sendJson(res, 200, result);
  } catch (err) {
    sendJson(res, 500, { error: err.message || 'Something went wrong processing that PDF.' });
  }
}

await loadEnvFile();

if (!process.env.OPENAI_API_KEY) {
  console.warn(
    '\n\u26A0  OPENAI_API_KEY is not set. Copy .env.example to .env.local and add your key,\n' +
    '   or export OPENAI_API_KEY in your shell before running this.\n'
  );
}

if (!process.env.GOOGLE_VISION_API_KEY) {
  console.warn(
    '\n\u26A0  GOOGLE_VISION_API_KEY is not set. The OCR stage will fail until it\u2019s added to .env.local.\n'
  );
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/extract') {
    handleExtract(req, res);
  } else if (req.method === 'GET') {
    serveStatic(req, res);
  } else {
    res.writeHead(405);
    res.end('Method not allowed');
  }
});

server.listen(PORT, () => {
  console.log(`RI shell running locally at http://localhost:${PORT}`);
});
