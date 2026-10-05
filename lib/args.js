'use strict';

class UsageError extends Error {}

// spec: { flagName: 'int' | 'string' | 'bool' }
function parseArgs(argv, spec) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (!arg.startsWith('--') || arg === '--') {
      positionals.push(arg);
      continue;
    }
    let name = arg.slice(2);
    let value;
    const eq = name.indexOf('=');
    if (eq !== -1) {
      value = name.slice(eq + 1);
      name = name.slice(0, eq);
    }
    const type = spec[name];
    if (!type) throw new UsageError(`Optiune necunoscuta: --${name}`);
    if (type === 'bool') {
      if (value !== undefined) throw new UsageError(`Optiunea --${name} nu primeste valoare.`);
      flags[name] = true;
      continue;
    }
    if (value === undefined) {
      value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new UsageError(`Optiunea --${name} necesita o valoare.`);
      }
      i++;
    }
    if (type === 'int') {
      if (!/^-?\d+$/.test(value)) throw new UsageError(`Optiunea --${name} trebuie sa fie un numar intreg.`);
      flags[name] = Number(value);
    } else {
      flags[name] = value;
    }
  }
  return { positionals, flags };
}

module.exports = { UsageError, parseArgs };
