import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '127.0.0.1';
const bundleDirectory = join(root, 'bundle');

function loadApplicationHtml() {
  const partNames = readdirSync(bundleDirectory)
    .filter((name) => name.startsWith('index.html.gz.b64.part-'))
    .sort((left, right) => left.localeCompare(right));

  if (partNames.length === 0) {
    throw new Error('The application bundle is missing.');
  }

  const base64 = partNames
    .map((name) => readFileSync(join(bundleDirectory, name), 'utf8').trim())
    .join('');

  return gunzipSync(Buffer.from(base64, 'base64')).toString('utf8');
}

const applicationHtml = injectFooter(loadApplicationHtml());

function injectFooter(html) {
  const footer = '<footer class="global-footer" aria-label="Project credit">Made with 💙 by arrf</footer>';
  const style = `<style>
    .global-footer {
      box-sizing: border-box;
      width: 100%;
      padding: 18px 24px 24px;
      border-top: 1px solid #c8c8c8;
      background: #e8e8e8;
      color: #656565;
      font: 500 12px/1.4 "Avenir Next", Avenir, "Helvetica Neue", Arial, sans-serif;
      letter-spacing: 0.02em;
      text-align: center;
    }
  </style>`;

  return html
    .replace('</head>', `${style}</head>`)
    .replace('</body>', `${footer}</body>`);
}

function send(response, status, body, headers = {}) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'text/plain; charset=utf-8',
    ...headers,
  });
  response.end(body);
}

async function importFujiXWeekly(request, response) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 32_768) {
      send(response, 413, JSON.stringify({ error: 'Request body is too large.' }), {
        'Content-Type': 'application/json; charset=utf-8',
      });
      return;
    }
  }

  try {
    const { url } = JSON.parse(body || '{}');
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'fujixweekly.com') {
      throw new Error('Only https://fujixweekly.com URLs are accepted.');
    }

    const upstream = await fetch(parsed, {
      headers: { 'User-Agent': 'Fuji-XE5-Recipes-Lab/0.1' },
      redirect: 'follow',
    });
    if (!upstream.ok) {
      throw new Error(`Fuji X Weekly returned HTTP ${upstream.status}.`);
    }

    send(response, 200, JSON.stringify({ html: await upstream.text(), url: upstream.url }), {
      'Content-Type': 'application/json; charset=utf-8',
    });
  } catch (error) {
    send(response, 400, JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      'Content-Type': 'application/json; charset=utf-8',
    });
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || `${host}:${port}`}`);

  if (request.method === 'POST' && url.pathname === '/api/import-url') {
    await importFujiXWeekly(request, response);
    return;
  }

  if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    send(response, 200, applicationHtml, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'self' blob: data:; script-src 'self' 'unsafe-inline' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' https://fujixweekly.com; img-src 'self' data: blob:; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    });
    return;
  }

  send(response, 404, 'Not found.');
});

server.listen(port, host, () => {
  console.log(`Fuji X-E5 Recipes Lab: http://${host}:${port}`);
});
