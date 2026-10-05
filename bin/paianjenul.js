#!/usr/bin/env node
'use strict';

const { version } = require('../package.json');
const { UsageError, parseArgs } = require('../lib/args');
const { EXIT, ApiError, request } = require('../lib/client');
const config = require('../lib/config');

const CONT_URL = 'https://www.paianjenul.ro/cont';

const HELP = `paianjenul ${version}: cauta firme romanesti din terminal (paianjenul.ro)

Utilizare / Usage:
  paianjenul search <text...> [--limit N]      Cauta firme dupa nume sau CUI (limit 1..10)
  paianjenul company <cui>                     Fisa firmei (CUI cu sau fara prefix RO)
  paianjenul financials <cui> [--years N]      Bilanturi pe ultimii N ani (1..6)
  paianjenul vat <cui>                         Status TVA la ANAF
  paianjenul advanced [optiuni]                Cautare avansata (doar plan Pro)
      --county X  --caen 62  --min-turnover N  --max-turnover N
      --min-employees N  --max-employees N  --year Y
      --sort turnover|employees|profit|name  --limit 1..50  --offset N
  paianjenul login                             Salveaza cheia API (din stdin)
  paianjenul logout                            Sterge cheia salvata
  paianjenul whoami                            Contul, planul si consumul de azi

Optiuni globale / Global options:
  --json          Afiseaza datele brute JSON in loc de rezumat (raw JSON data)
  -h, --help      Acest mesaj (this help)
  --version       Versiunea (version)

Cheia API: creeaza una la ${CONT_URL}, apoi ruleaza "paianjenul login"
sau seteaza variabila PAIANJENUL_API_KEY.

Coduri de iesire / Exit codes:
  0 ok, 1 utilizare gresita, 2 date invalide, 3 negasit,
  4 neautorizat sau fara cheie, 5 limita atinsa sau Pro necesar,
  6 eroare server sau retea
`;

const ADVANCED_FLAGS = {
  county: 'county',
  caen: 'caen',
  'min-turnover': 'minTurnover',
  'max-turnover': 'maxTurnover',
  'min-employees': 'minEmployees',
  'max-employees': 'maxEmployees',
  year: 'year',
  sort: 'sort',
  limit: 'limit',
  offset: 'offset',
};

const COMMANDS = {
  search: {
    flags: { limit: 'int' },
    run: (pos, flags, ctx) => {
      const q = pos.join(' ').trim();
      if (!q) throw new UsageError('Lipseste textul de cautat. Exemplu: paianjenul search freeapp');
      return api('/api/v1/search', ctx, { q, limit: flags.limit });
    },
  },
  company: {
    flags: {},
    run: (pos, flags, ctx) => api(`/api/v1/company/${cuiArg(pos, 'company')}`, ctx),
  },
  financials: {
    flags: { years: 'int' },
    run: (pos, flags, ctx) =>
      api(`/api/v1/company/${cuiArg(pos, 'financials')}/financials`, ctx, { years: flags.years }),
  },
  vat: {
    flags: {},
    run: (pos, flags, ctx) => api(`/api/v1/vat/${cuiArg(pos, 'vat')}`, ctx),
  },
  advanced: {
    flags: {
      county: 'string', caen: 'string', 'min-turnover': 'int', 'max-turnover': 'int',
      'min-employees': 'int', 'max-employees': 'int', year: 'int', sort: 'string',
      limit: 'int', offset: 'int',
    },
    run: (pos, flags, ctx) => {
      if (pos.length) throw new UsageError(`Argument neasteptat: ${pos[0]}`);
      const query = {};
      for (const [flag, param] of Object.entries(ADVANCED_FLAGS)) query[param] = flags[flag];
      return api('/api/v1/advanced', ctx, query);
    },
  },
  whoami: {
    flags: {},
    run: async (pos, flags, ctx) => {
      if (pos.length) throw new UsageError(`Argument neasteptat: ${pos[0]}`);
      const body = await request('/api/v1/usage', { key: requireKey() });
      const d = body.data || {};
      if (ctx.json) return printJson(d);
      process.stdout.write(
        `Email: ${d.email}\nPlan: ${d.plan}\nConsum azi: ${d.used}/${d.limit === null || d.limit === undefined ? 'nelimitat' : d.limit}\n`,
      );
    },
  },
  login: {
    flags: {},
    run: async (pos) => {
      if (pos.length) throw new UsageError('Comanda login nu primeste argumente; cheia se citeste din stdin.');
      const key = (await readKey()).trim();
      if (!config.isValidKey(key)) {
        throw new ApiError(
          `Cheia nu are formatul corect (pj_ urmat de 43 de caractere). Copiaz-o din ${CONT_URL}`,
          EXIT.BAD_INPUT,
        );
      }
      const body = await request('/api/v1/usage', { key });
      const file = config.storeKey(key);
      const d = body.data || {};
      process.stdout.write(`Autentificat ca ${d.email} (plan ${d.plan}). Cheia a fost salvata in ${file}\n`);
    },
  },
  logout: {
    flags: {},
    run: async () => {
      const removed = config.deleteKey();
      process.stdout.write(removed ? 'Cheia a fost stearsa.\n' : 'Nu exista nicio cheie salvata.\n');
      if (process.env.PAIANJENUL_API_KEY) {
        process.stderr.write('Atentie: variabila PAIANJENUL_API_KEY este inca setata in mediu.\n');
      }
    },
  },
};

function cuiArg(pos, cmd) {
  if (pos.length !== 1) throw new UsageError(`Utilizare: paianjenul ${cmd} <cui>`);
  return encodeURIComponent(pos[0].trim());
}

function requireKey() {
  const key = config.resolveKey();
  if (!key) {
    throw new ApiError(
      `Lipseste cheia API. Creeaza una la ${CONT_URL} si ruleaza "paianjenul login" ` +
        '(sau seteaza PAIANJENUL_API_KEY).',
      EXIT.UNAUTHORIZED,
    );
  }
  return key;
}

function printJson(data) {
  process.stdout.write(JSON.stringify(data === undefined ? null : data, null, 2) + '\n');
}

async function api(pathname, ctx, query) {
  const body = await request(pathname, { key: requireKey(), query });
  if (ctx.json || typeof body.text !== 'string') return printJson(body.data);
  process.stdout.write(body.text.endsWith('\n') ? body.text : body.text + '\n');
}

function readKey() {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    return new Promise((resolve, reject) => {
      let buf = '';
      stdin.setEncoding('utf8');
      stdin.on('data', (c) => { buf += c; });
      stdin.on('end', () => resolve(buf.split(/\r?\n/).find((l) => l.trim()) || ''));
      stdin.on('error', reject);
    });
  }
  return new Promise((resolve, reject) => {
    process.stderr.write(`Lipeste cheia API de la ${CONT_URL} (nu va fi afisata): `);
    let buf = '';
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    const done = (fn) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      process.stderr.write('\n');
      fn();
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') return done(() => resolve(buf));
        if (ch === '\u0003') return done(() => reject(new ApiError('Anulat.', EXIT.USAGE)));
        if (ch === '\u007f' || ch === '\b') buf = buf.slice(0, -1);
        else if (ch >= ' ') buf += ch;
      }
    };
    stdin.on('data', onData);
  });
}

function redact(text) {
  const key = config.resolveKey();
  let out = String(text);
  if (key) out = out.split(key).join('pj_***');
  return out.replace(/pj_[A-Za-z0-9_-]{43}/g, 'pj_***');
}

async function main(argv) {
  if (argv.includes('-h') || argv.includes('--help')) {
    process.stdout.write(HELP);
    return EXIT.OK;
  }
  if (argv.includes('--version')) {
    process.stdout.write(version + '\n');
    return EXIT.OK;
  }
  const json = argv.includes('--json');
  const rest = argv.filter((a) => a !== '--json');
  const [name, ...args] = rest;
  if (!name || name === 'help') {
    process.stdout.write(HELP);
    return EXIT.OK;
  }
  const command = Object.prototype.hasOwnProperty.call(COMMANDS, name) ? COMMANDS[name] : null;
  if (!command) {
    throw new UsageError(`Comanda necunoscuta: ${name}. Ruleaza "paianjenul --help".`);
  }
  const { positionals, flags } = parseArgs(args, command.flags);
  await command.run(positionals, flags, { json });
  return EXIT.OK;
}

main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code; },
  (err) => {
    if (err instanceof UsageError) {
      process.stderr.write(`Eroare: ${redact(err.message)}\n`);
      process.exitCode = EXIT.USAGE;
    } else if (err instanceof ApiError) {
      process.stderr.write(`Eroare: ${redact(err.message)}\n`);
      process.exitCode = err.exitCode;
    } else {
      process.stderr.write(`Eroare neasteptata: ${redact(err && err.message ? err.message : err)}\n`);
      process.exitCode = EXIT.UPSTREAM;
    }
  },
);
