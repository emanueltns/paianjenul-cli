'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const KEY_PATTERN = /^pj_[A-Za-z0-9_-]{43}$/;

function configDir(env = process.env) {
  const base = env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.trim()
    ? env.XDG_CONFIG_HOME
    : path.join(env.HOME || os.homedir(), '.config');
  return path.join(base, 'paianjenul');
}

function keyFile(env = process.env) {
  return path.join(configDir(env), 'key');
}

function isValidKey(key) {
  return typeof key === 'string' && KEY_PATTERN.test(key);
}

function readStoredKey(env = process.env) {
  try {
    const value = fs.readFileSync(keyFile(env), 'utf8').trim();
    return value || null;
  } catch {
    return null;
  }
}

function resolveKey(env = process.env) {
  const fromEnv = env.PAIANJENUL_API_KEY && env.PAIANJENUL_API_KEY.trim();
  if (fromEnv) return fromEnv;
  return readStoredKey(env);
}

function storeKey(key, env = process.env) {
  const dir = configDir(env);
  const file = keyFile(env);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // mkdir and writeFile modes are reduced by umask and ignored for existing paths.
  fs.chmodSync(dir, 0o700);
  fs.writeFileSync(file, key + '\n', { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return file;
}

function deleteKey(env = process.env) {
  const file = keyFile(env);
  try {
    fs.unlinkSync(file);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

module.exports = { KEY_PATTERN, configDir, keyFile, isValidKey, readStoredKey, resolveKey, storeKey, deleteKey };
