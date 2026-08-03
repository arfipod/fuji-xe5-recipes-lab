import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '127.0.0.1';
const root = fileURLToPath(new URL('.', import.meta.url));
const sourceRoot = resolve(root, 'src');
let latestValidationReport = null;
const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
]);

function send(response, status, body, headers = {}) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'text/plain; charset=utf-8',
    ...headers,
  });
  response.end(body);
}

async function importFujiXWeekly(request, response, requestUrl) {
  try {
    let rawUrl = requestUrl.searchParams.get('url');
    if (request.method === 'POST') {
      let body = '';
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 32_768) throw new Error('Request body is too large.');
      }
      rawUrl = JSON.parse(body || '{}').url;
    }
    if (!rawUrl) throw new Error('A Fuji X Weekly URL is required.');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const upstream = await fetchRestrictedFujiUrl(new URL(rawUrl), controller.signal);
      if (!upstream.ok) throw new Error(`Fuji X Weekly returned HTTP ${upstream.status}.`);
      const declaredLength = Number(upstream.headers.get('content-length') || 0);
      if (declaredLength > 4_000_000) throw new Error('The article exceeds the 4 MB importer limit.');
      const html = await upstream.text();
      if (html.length > 4_000_000) throw new Error('The article exceeds the 4 MB importer limit.');
      const title = extractTitle(html);
      const articleHtml = extractLongestTag(html, 'article') ?? extractLongestTag(html, 'main') ?? html;
      send(response, 200, JSON.stringify({ text: htmlToText(articleHtml), title, url: upstream.url }), {
        'Content-Type': 'application/json; charset=utf-8',
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError'
      ? 'The Fuji X Weekly request timed out.'
      : error instanceof Error ? error.message : String(error);
    send(response, 400, JSON.stringify({ error: message }), {
      'Content-Type': 'application/json; charset=utf-8',
    });
  }
}

async function receiveValidationReport(request, response) {
  try {
    if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
      throw new Error('The validation report must use application/json.');
    }
    let body = '';
    for await (const chunk of request) {
      body += chunk;
      if (body.length > 2_000_000) throw new Error('The validation report exceeds the 2 MB limit.');
    }
    const parsed = JSON.parse(body || 'null');
    assertSafeValidationReport(parsed);
    latestValidationReport = parsed;
    send(response, 202, JSON.stringify({ accepted: true }), {
      'Content-Type': 'application/json; charset=utf-8',
    });
  } catch (error) {
    send(response, 400, JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      'Content-Type': 'application/json; charset=utf-8',
    });
  }
}

function assertSafeValidationReport(value, depth = 0, path = []) {
  if (depth > 14) throw new Error('The validation report is nested too deeply.');
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) assertSafeValidationReport(item, depth + 1, path);
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (/serial|cameraKey|deviceId|backupBytes|bytesBase64|blob/i.test(key)) {
      throw new Error('The validation report contains a prohibited sensitive or binary key.');
    }
    if (path.length === 1 && path[0] === 'fullBackup' && /^(?:bytes|data|payload|rawBytes|arrayBuffer)$/i.test(key)) {
      throw new Error('The full-backup report contains prohibited whole-backup bytes.');
    }
    assertSafeValidationReport(item, depth + 1, [...path, key]);
  }
}

async function fetchRestrictedFujiUrl(initialUrl, signal) {
  let target = initialUrl;
  for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
    assertFujiXWeeklyUrl(target);
    const response = await fetch(target, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'Fuji-XE5-Recipes-Lab/0.1 (+local personal research tool)',
      },
      redirect: 'manual',
      signal,
    });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get('location');
    if (!location) throw new Error('Fuji X Weekly returned a redirect without a location.');
    target = new URL(location, target);
  }
  throw new Error('Fuji X Weekly returned too many redirects.');
}

function assertFujiXWeeklyUrl(url) {
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || (hostname !== 'fujixweekly.com' && hostname !== 'www.fujixweekly.com')) {
    throw new Error('Only https://fujixweekly.com URLs are accepted.');
  }
}

function extractTitle(html) {
  const heading = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const title = heading ?? html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '';
  return htmlToText(title).split('\n')[0].trim();
}

function extractLongestTag(html, tag) {
  const expression = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  return [...html.matchAll(expression)].map((match) => match[1]).sort((left, right) => right.length - left.length)[0] ?? null;
}

function htmlToText(html) {
  return decodeEntities(String(html))
    .replace(/<(script|style|noscript|svg|form|nav|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/(p|div|li|h1|h2|h3|h4|section|blockquote|tr)>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeEntities(value) {
  const named = { nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', ndash: '-', mdash: '-', minus: '-', hellip: '…', frac13: '1/3', frac23: '2/3' };
  return value.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]+);/gi, (entity, token) => {
    if (token[0] !== '#') return named[token.toLowerCase()] ?? entity;
    const hexadecimal = token[1]?.toLowerCase() === 'x';
    const number = Number.parseInt(token.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
    return Number.isFinite(number) ? String.fromCodePoint(number) : entity;
  });
}

const server = createServer(async (request, response) => {
  try {
    setSecurityHeaders(response);
    const url = new URL(request.url || '/', `http://${request.headers.host || `${host}:${port}`}`);

    if ((request.method === 'GET' || request.method === 'POST') && url.pathname === '/api/import-url') {
      await importFujiXWeekly(request, response, url);
      return;
    }

    if (url.pathname === '/api/validation-report') {
      if (request.method === 'POST') {
        await receiveValidationReport(request, response);
      } else if (request.method === 'GET') {
        send(response, latestValidationReport ? 200 : 404, JSON.stringify(latestValidationReport ?? { error: 'No validation report is available.' }), {
          'Content-Type': 'application/json; charset=utf-8',
        });
      } else {
        send(response, 405, 'Method not allowed.', { Allow: 'GET, POST' });
      }
      return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      send(response, 405, 'Method not allowed.', { Allow: 'GET, HEAD, POST' });
      return;
    }

    const filePath = resolveStaticPath(url.pathname);
    if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
      send(response, 404, 'Not found.');
      return;
    }

    const stat = statSync(filePath);
    response.writeHead(200, {
      'Cache-Control': filePath.endsWith('index.html') ? 'no-store' : 'no-cache',
      'Content-Length': stat.size,
      'Content-Type': mimeTypes.get(extname(filePath).toLowerCase()) || 'application/octet-stream',
    });
    if (request.method === 'HEAD') response.end();
    else createReadStream(filePath).pipe(response);
  } catch (error) {
    send(response, 500, 'Internal server error.');
    console.error('Local request failed:', error instanceof Error ? error.message : String(error));
  }
});

server.on('error', (error) => {
  const detail = error && typeof error === 'object' && 'code' in error ? `${error.code}: ${error.message}` : String(error);
  console.error(`Fuji X-E5 Recipes Lab could not start on http://${host}:${port}: ${detail}`);
  process.exitCode = 1;
});

server.listen(port, host, () => {
  console.log(`Fuji X-E5 Recipes Lab: http://${host}:${port}`);
});

function resolveStaticPath(pathname) {
  if (pathname === '/' || pathname === '/index.html') return resolve(root, 'index.html');
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (!decoded.startsWith('/src/')) return null;
  const filePath = resolve(root, `.${decoded}`);
  return filePath.startsWith(`${sourceRoot}/`) ? filePath : null;
}

function setSecurityHeaders(response) {
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), usb=(self)');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
}
