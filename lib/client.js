'use strict';

const { version } = require('../package.json');

const DEFAULT_BASE = 'https://www.paianjenul.ro';
const DEFAULT_TIMEOUT_MS = 20000;

const EXIT = {
  OK: 0,
  USAGE: 1,
  BAD_INPUT: 2,
  NOT_FOUND: 3,
  UNAUTHORIZED: 4,
  LIMIT: 5,
  UPSTREAM: 6,
};

const CODE_TO_EXIT = {
  bad_input: EXIT.BAD_INPUT,
  not_found: EXIT.NOT_FOUND,
  unauthorized: EXIT.UNAUTHORIZED,
  pro_required: EXIT.LIMIT,
  limit: EXIT.LIMIT,
  upstream: EXIT.UPSTREAM,
};

const STATUS_TO_EXIT = {
  400: EXIT.BAD_INPUT,
  401: EXIT.UNAUTHORIZED,
  402: EXIT.LIMIT,
  403: EXIT.UNAUTHORIZED,
  404: EXIT.NOT_FOUND,
  429: EXIT.LIMIT,
};

class ApiError extends Error {
  constructor(message, exitCode, code) {
    super(message);
    this.exitCode = exitCode;
    this.code = code;
  }
}

function baseUrl(env = process.env) {
  const raw = (env.PAIANJENUL_BASE || DEFAULT_BASE).trim();
  return raw.replace(/\/+$/, '');
}

function timeoutMs(env = process.env) {
  const n = Number(env.PAIANJENUL_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}

function buildUrl(pathname, query, env) {
  const url = new URL(baseUrl(env) + pathname);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  return url;
}

async function request(pathname, { key, query, env = process.env } = {}) {
  const url = buildUrl(pathname, query, env);
  let res;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${key}`,
        'User-Agent': `paianjenul-cli/${version}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(timeoutMs(env)),
    });
  } catch (err) {
    const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    const msg = timedOut
      ? `Serverul nu a raspuns in ${Math.round(timeoutMs(env) / 1000)} s.`
      : `Nu ne-am putut conecta la ${baseUrl(env)}.`;
    throw new ApiError(msg, EXIT.UPSTREAM, timedOut ? 'timeout' : 'network');
  }

  let body;
  try {
    body = await res.json();
  } catch {
    throw new ApiError(`Raspuns invalid de la server (HTTP ${res.status}).`, EXIT.UPSTREAM, 'invalid_response');
  }

  if (res.ok && body && body.success === true) return body;

  const code = body && typeof body.code === 'string' ? body.code : null;
  const exitCode = (code && CODE_TO_EXIT[code]) || STATUS_TO_EXIT[res.status] || EXIT.UPSTREAM;
  const message = (body && typeof body.error === 'string' && body.error) || `Eroare HTTP ${res.status}.`;
  throw new ApiError(message, exitCode, code || `http_${res.status}`);
}

module.exports = { DEFAULT_BASE, EXIT, ApiError, request, baseUrl };
