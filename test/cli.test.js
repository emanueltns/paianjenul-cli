'use strict';

const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const BIN = path.join(__dirname, '..', 'bin', 'paianjenul.js');
const { version } = require('../package.json');

const PRO_KEY = 'pj_' + 'P'.repeat(43);
const FREE_KEY = 'pj_' + 'F'.repeat(42) + '-';
const LIMITED_KEY = 'pj_' + 'L'.repeat(42) + '_';
const BAD_KEY = 'pj_' + 'B'.repeat(43);
const ALL_KEYS = [PRO_KEY, FREE_KEY, LIMITED_KEY, BAD_KEY];

const USERS = {
  [PRO_KEY]: { plan: 'pro', used: 2, limit: null, email: 'pro@example.ro' },
  [FREE_KEY]: { plan: 'free', used: 1, limit: 5, email: 'free@example.ro' },
  [LIMITED_KEY]: { plan: 'free', used: 5, limit: 5, email: 'limited@example.ro' },
};

const COMPANY = { cui: '14399840', name: 'DANTE INTERNATIONAL SA', county: 'Bucuresti' };

let server;
let base;
let requests;
let tmp;

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
const ok = (res, data, text) => send(res, 200, { success: true, data, text });
const fail = (res, status, code, error) => send(res, status, { success: false, code, error });

function handler(req, res) {
  const url = new URL(req.url, 'http://stub');
  requests.push({ path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers });

  if (req.headers['user-agent'] !== `paianjenul-cli/${version}`) return fail(res, 400, 'bad_input', 'bad UA');
  const auth = req.headers.authorization || '';
  const key = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const user = USERS[key];
  if (!user) return fail(res, 401, 'unauthorized', 'Cheie API invalida.');

  const p = url.pathname;
  if (p === '/api/v1/usage') return ok(res, user, `Plan ${user.plan}`);

  if (p === '/api/v1/search') {
    const q = url.searchParams.get('q');
    if (q === 'boom') return fail(res, 502, 'upstream', 'Sursa de date nu raspunde.');
    if (q === 'html') {
      res.writeHead(502, { 'Content-Type': 'text/html' });
      return res.end('<html>Bad gateway</html>');
    }
    if (q === 'slow') return setTimeout(() => ok(res, [], 'lent'), 3000);
    return ok(res, [COMPANY], `1 rezultat pentru "${q}": ${COMPANY.name}`);
  }

  if (p === '/api/v1/advanced') {
    if (user.plan !== 'pro') return fail(res, 402, 'pro_required', 'Cautarea avansata necesita planul Pro.');
    return ok(res, { total: 1, items: [COMPANY] }, '1 firma gasita in Cluj.');
  }

  const m = p.match(/^\/api\/v1\/(company|vat)\/([^/]+)(\/financials)?$/);
  if (m) {
    const cui = decodeURIComponent(m[2]).replace(/^RO/i, '');
    if (!/^\d{2,10}$/.test(cui)) return fail(res, 400, 'bad_input', 'CUI invalid.');
    if (cui === '404') return fail(res, 404, 'not_found', 'Firma nu a fost gasita.');
    if (key === LIMITED_KEY) return fail(res, 429, 'limit', 'Ai atins limita de 5 firme pe zi.');
    if (m[1] === 'vat') return ok(res, { cui, vat: true }, `Firma ${cui} este platitoare de TVA.`);
    if (m[3]) return ok(res, { cui, years: [{ year: 2024, turnover: 1000 }] }, `Bilant ${cui}: cifra de afaceri 1000 lei.`);
    return ok(res, { ...COMPANY, cui }, `${COMPANY.name}, CUI ${cui}, ${COMPANY.county}.`);
  }
  return fail(res, 404, 'not_found', 'Ruta necunoscuta.');
}

function run(args, { key, input, env: extraEnv } = {}) {
  const env = { ...process.env, PAIANJENUL_BASE: base, XDG_CONFIG_HOME: tmp, HOME: tmp };
  delete env.PAIANJENUL_API_KEY;
  delete env.PAIANJENUL_TIMEOUT_MS;
  if (key) env.PAIANJENUL_API_KEY = key;
  Object.assign(env, extraEnv);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', reject);
    child.on('close', (code) => {
      for (const k of ALL_KEYS) {
        assert.ok(!stdout.includes(k), `key leaked to stdout: ${args.join(' ')}`);
        assert.ok(!stderr.includes(k), `key leaked to stderr: ${args.join(' ')}`);
      }
      resolve({ code, stdout, stderr });
    });
    if (input !== undefined) child.stdin.write(input);
    child.stdin.end();
  });
}

const keyPath = () => path.join(tmp, 'paianjenul', 'key');

before(async () => {
  server = http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((r) => server.close(r)));
beforeEach(() => {
  requests = [];
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paianjenul-test-'));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('--help, -h, help and no args print help with exit 0', async () => {
  for (const args of [['--help'], ['-h'], ['help'], []]) {
    const r = await run(args);
    assert.equal(r.code, 0, args.join(' '));
    assert.match(r.stdout, /paianjenul search/);
    assert.match(r.stdout, /Coduri de iesire/);
  }
});

test('--version prints package version', async () => {
  const r = await run(['--version']);
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), version);
});

test('unknown command, unknown flag and bad flag values exit 1', async () => {
  for (const args of [['frobnicate'], ['search', 'x', '--bogus'], ['search', 'x', '--limit', 'abc'],
    ['search', 'x', '--limit'], ['company'], ['company', '1', '2'], ['search'], ['advanced', 'extra']]) {
    const r = await run(args, { key: PRO_KEY });
    assert.equal(r.code, 1, args.join(' '));
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /Eroare/);
  }
  assert.equal(requests.length, 0);
});

test('search prints text and sends auth, UA, q and limit', async () => {
  const r = await run(['search', 'dante', 'international', '--limit', '3'], { key: PRO_KEY });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /1 rezultat pentru "dante international"/);
  assert.equal(requests.length, 1);
  const req = requests[0];
  assert.equal(req.path, '/api/v1/search');
  assert.deepEqual(req.query, { q: 'dante international', limit: '3' });
  assert.equal(req.headers.authorization, `Bearer ${PRO_KEY}`);
  assert.equal(req.headers['user-agent'], `paianjenul-cli/${version}`);
});

test('--json prints the raw data pretty-printed, flag accepted anywhere', async () => {
  for (const args of [['--json', 'search', 'dante'], ['search', 'dante', '--json']]) {
    const r = await run(args, { key: PRO_KEY });
    assert.equal(r.code, 0);
    assert.deepEqual(JSON.parse(r.stdout), [COMPANY]);
    assert.equal(r.stdout, JSON.stringify([COMPANY], null, 2) + '\n');
  }
});

test('company accepts RO prefix', async () => {
  const r = await run(['company', 'RO14399840'], { key: FREE_KEY });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /DANTE INTERNATIONAL SA, CUI 14399840/);
  assert.equal(requests[0].path, '/api/v1/company/RO14399840');
});

test('financials passes --years', async () => {
  const r = await run(['financials', '14399840', '--years=4'], { key: PRO_KEY });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Bilant 14399840/);
  assert.equal(requests[0].path, '/api/v1/company/14399840/financials');
  assert.deepEqual(requests[0].query, { years: '4' });
});

test('vat', async () => {
  const r = await run(['vat', '14399840', '--json'], { key: PRO_KEY });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { cui: '14399840', vat: true });
  assert.equal(requests[0].path, '/api/v1/vat/14399840');
});

test('advanced maps every flag to the API query params', async () => {
  const r = await run([
    'advanced', '--county', 'Cluj', '--caen', '62', '--min-turnover', '1000', '--max-turnover', '90000',
    '--min-employees', '5', '--max-employees', '50', '--year', '2024', '--sort', 'profit',
    '--limit', '20', '--offset', '40',
  ], { key: PRO_KEY });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /1 firma gasita in Cluj/);
  assert.equal(requests[0].path, '/api/v1/advanced');
  assert.deepEqual(requests[0].query, {
    county: 'Cluj', caen: '62', minTurnover: '1000', maxTurnover: '90000', minEmployees: '5',
    maxEmployees: '50', year: '2024', sort: 'profit', limit: '20', offset: '40',
  });
});

test('400 bad_input exits 2', async () => {
  const r = await run(['company', 'abc'], { key: PRO_KEY });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /CUI invalid/);
  assert.equal(r.stdout, '');
});

test('401 unauthorized exits 4', async () => {
  const r = await run(['company', '14399840'], { key: BAD_KEY });
  assert.equal(r.code, 4);
  assert.match(r.stderr, /Cheie API invalida/);
});

test('402 pro_required exits 5', async () => {
  const r = await run(['advanced', '--county', 'Cluj'], { key: FREE_KEY });
  assert.equal(r.code, 5);
  assert.match(r.stderr, /planul Pro/);
});

test('404 not_found exits 3', async () => {
  const r = await run(['company', '404'], { key: PRO_KEY });
  assert.equal(r.code, 3);
  assert.match(r.stderr, /nu a fost gasita/);
});

test('429 limit exits 5', async () => {
  const r = await run(['company', '14399840'], { key: LIMITED_KEY });
  assert.equal(r.code, 5);
  assert.match(r.stderr, /limita de 5 firme/);
});

test('502 upstream exits 6, including a non-JSON body', async () => {
  let r = await run(['search', 'boom'], { key: PRO_KEY });
  assert.equal(r.code, 6);
  assert.match(r.stderr, /Sursa de date nu raspunde/);
  r = await run(['search', 'html'], { key: PRO_KEY });
  assert.equal(r.code, 6);
  assert.match(r.stderr, /Raspuns invalid/);
});

test('network down exits 6', async () => {
  const dead = http.createServer();
  await new Promise((r) => dead.listen(0, '127.0.0.1', r));
  const port = dead.address().port;
  await new Promise((r) => dead.close(r));
  const r = await run(['company', '14399840'], { key: PRO_KEY, env: { PAIANJENUL_BASE: `http://127.0.0.1:${port}` } });
  assert.equal(r.code, 6);
  assert.match(r.stderr, /Nu ne-am putut conecta/);
});

test('request timeout exits 6', async () => {
  const r = await run(['search', 'slow'], { key: PRO_KEY, env: { PAIANJENUL_TIMEOUT_MS: '300' } });
  assert.equal(r.code, 6);
  assert.match(r.stderr, /nu a raspuns/);
});

test('no key exits 4 and points to /cont and login', async () => {
  for (const args of [['company', '14399840'], ['whoami']]) {
    const r = await run(args);
    assert.equal(r.code, 4, args.join(' '));
    assert.match(r.stderr, /https:\/\/www\.paianjenul\.ro\/cont/);
    assert.match(r.stderr, /paianjenul login/);
  }
  assert.equal(requests.length, 0);
});

test('whoami prints email, plan and usage, never the key', async () => {
  const r = await run(['whoami'], { key: FREE_KEY });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Email: free@example\.ro/);
  assert.match(r.stdout, /Plan: free/);
  assert.match(r.stdout, /Consum azi: 1\/5/);
  const pro = await run(['whoami'], { key: PRO_KEY });
  assert.match(pro.stdout, /Consum azi: 2\/nelimitat/);
});

test('login via piped stdin stores the key with mode 600 in a 700 dir, then it is used', async () => {
  const r = await run(['login'], { input: FREE_KEY + '\n' });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Autentificat ca free@example\.ro/);
  assert.equal(fs.readFileSync(keyPath(), 'utf8').trim(), FREE_KEY);
  assert.equal(fs.statSync(keyPath()).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(keyPath())).mode & 0o777, 0o700);
  assert.equal(requests[0].path, '/api/v1/usage');

  const who = await run(['whoami']);
  assert.equal(who.code, 0, who.stderr);
  assert.match(who.stdout, /free@example\.ro/);
  assert.equal(requests[1].headers.authorization, `Bearer ${FREE_KEY}`);
});

test('env PAIANJENUL_API_KEY wins over the stored key', async () => {
  await run(['login'], { input: FREE_KEY });
  const r = await run(['whoami'], { key: PRO_KEY });
  assert.match(r.stdout, /pro@example\.ro/);
});

test('login falls back to ~/.config when XDG_CONFIG_HOME is unset', async () => {
  const r = await run(['login'], { input: PRO_KEY, env: { XDG_CONFIG_HOME: '' } });
  assert.equal(r.code, 0, r.stderr);
  const file = path.join(tmp, '.config', 'paianjenul', 'key');
  assert.equal(fs.readFileSync(file, 'utf8').trim(), PRO_KEY);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('login rejects a malformed key with exit 2 and stores nothing', async () => {
  const r = await run(['login'], { input: 'pj_tooshort\n' });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /formatul corect/);
  assert.ok(!r.stderr.includes('pj_tooshort'));
  assert.equal(fs.existsSync(keyPath()), false);
  assert.equal(requests.length, 0);
});

test('login with a key the server rejects exits 4 and stores nothing', async () => {
  const r = await run(['login'], { input: BAD_KEY });
  assert.equal(r.code, 4);
  assert.equal(fs.existsSync(keyPath()), false);
});

test('logout deletes the stored key; second logout is harmless', async () => {
  await run(['login'], { input: PRO_KEY });
  assert.ok(fs.existsSync(keyPath()));
  let r = await run(['logout']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /stearsa/);
  assert.equal(fs.existsSync(keyPath()), false);
  r = await run(['logout']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Nu exista/);
  r = await run(['whoami']);
  assert.equal(r.code, 4);
});
