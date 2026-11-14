#!/usr/bin/env node
// Puts the checked items into the Vault, piping each value from where it
// lives straight into `instabox vault set` / `vault set-file`.
//
//   node push.mjs --selection selection.json --dry-run   # names, sizes, what it would do
//   node push.mjs --selection selection.json
//
// A value is held in this process's memory between reading it and writing
// it to instabox's stdin; it is never printed, logged or put on a command
// line. Output: one line per Vault item with its name, kind, size and outcome.
//
// Every value is read and the totals checked against the Vault's limits
// before anything is written: over them, nothing is written (exit 3).
// An item that is in the Vault now but was not when the plan was written,
// and was not set by this skill, is left alone. The manifest
// (~/.config/instabox-basic-setup/pushed.json: names, kinds, paths; no
// values) records what this skill set, so a later run replaces those.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileContent } from './content.mjs';
import { VAULT_MAX_ITEMS, VAULT_MAX_TOTAL, VAULT_MAX_VALUE, human, isMain, run, selectorString } from './lib.mjs';
import { MANIFEST, readManifest } from './plan.mjs';

const shellFor = (file) => (/\/\.z[^/]*$/.test(file) && spawnSync('zsh', ['-c', 'true']).status === 0 ? 'zsh' : 'bash');

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

// The values of some variables a shell startup file exports, sourcing it once: {name: value}.
// Never logged. The file is sourced the way a shell does, its output discarded, and only the
// variables are printed (NUL-separated: a shell variable cannot hold a NUL). Names still unset
// after that get one more try in an interactive shell, for rc files that start with the usual
// `case $- in *i*)` / `[[ -o interactive ]] || return` guard; that shell reads no startup file
// of its own, so nothing it prints reaches the output.
export function readRc(file, names, env = process.env) {
  const got = {};
  const zsh = shellFor(file) === 'zsh';
  for (const interactive of [false, true]) {
    const want = names.filter((n) => NAME.test(n) && !got[n]);
    if (!want.length) break;
    const flags = interactive ? (zsh ? ['-f', '-i'] : ['--norc', '--noprofile', '-i']) : [];
    const script = `. "$1" >/dev/null 2>&1 </dev/null; printf '%s\\0' ${want.map((n) => `"\${${n}-}"`).join(' ')}`;
    const r = spawnSync(zsh ? 'zsh' : 'bash', [...flags, '-c', script, 'instabox-basic-setup', file], {
      env,
      encoding: 'utf8',
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const vals = (r.stdout || '').split('\0');
    want.forEach((n, i) => {
      if (vals[i]) got[n] = vals[i];
    });
  }
  return got;
}

// The value of one token, or {error}. Never logged. rc: {file: {name: value}} already read by
// readRc, so a file holding several tokens is sourced once.
export function readValue(src, env = process.env, rc = {}) {
  try {
    switch (src.type) {
      case 'env':
        return env[src.name] ? { value: env[src.name] } : { error: `${src.name} is not set in this environment` };
      case 'rc': {
        if (!NAME.test(src.name)) return { error: 'bad name' };
        const v = (rc[src.file] ?? readRc(src.file, [src.name], env))[src.name];
        if (v) return { value: v };
        // The shell this runs from may have it already (an rc that returned early, or set it some other way).
        if (env[src.name]) return { value: env[src.name] };
        return {
          error: `${src.name} is not set after sourcing ${src.file} (also tried as an interactive shell), nor in this environment`,
        };
      }
      case 'cmd': {
        const r = run(src.argv, { env });
        const v = r.stdout.replace(/\n$/, '');
        return r.ok && v ? { value: v } : { error: `\`${src.argv.join(' ')}\` failed (exit ${r.status})` };
      }
    }
  } catch (e) {
    return { error: e.code || 'unreadable' };
  }
  return { error: `unknown source ${src.type}` };
}

// instabox's own output with the value masked, in case a message ever echoes it.
const mask = (text, value) => (value ? text.split(value).join('***') : text).trim().split('\n').pop() || '';

function writeManifest(path, items) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify({ version: 1, items }, null, 2) + '\n', { mode: 0o600 });
  renameSync(tmp, path);
}

export function push(sel, { instabox = 'instabox', env = process.env, dryRun = false, manifestPath = MANIFEST, log = (s) => console.log(s) } = {}) {
  const results = [];
  const fail = (msg) => {
    log(msg);
    return { ok: false, code: 1, results };
  };
  const ls = run([instabox, 'vault', 'ls', '--json'], { env });
  if (!ls.ok) return fail(`instabox vault ls failed: ${ls.stderr.trim().split('\n').pop()} (signed in? \`instabox login\`; INSTABOX_API_KEY must be unset)`);
  let vault;
  try {
    vault = JSON.parse(ls.stdout).items || [];
  } catch {
    return fail('instabox vault ls --json did not print JSON; is the instabox CLI up to date?');
  }
  let maxItems = VAULT_MAX_ITEMS;
  let maxBytes = VAULT_MAX_TOTAL;
  const usage = run([instabox, 'usage', '--json'], { env });
  try {
    const l = JSON.parse(usage.stdout).limits?.vault;
    if (l?.maxItems) maxItems = l.maxItems;
    if (l?.maxBytes) maxBytes = l.maxBytes;
  } catch {}

  const manifest = readManifest(manifestPath);
  const ours = new Set(manifest.items.map((m) => m.name));
  const byName = new Map(vault.map((v) => [v.name, v]));
  const byPath = new Map(vault.filter((v) => v.path).map((v) => [v.path, v]));
  const selector = sel.selector || {};
  // One --selector per label: the CLI's flag takes key=value and repeats.
  const selFlag = Object.entries(selector).flatMap(([k, v]) => ['--selector', `${k}=${v}`]);

  // 1. Every Vault item this selection makes, with its value, in memory only. Each shell
  // startup file is sourced once for all the tokens read from it, and only if one is needed.
  const rcNames = new Map();
  for (const it of sel.items) {
    if (it.kind !== 'env' || it.source?.type !== 'rc') continue;
    if (!rcNames.has(it.source.file)) rcNames.set(it.source.file, []);
    rcNames.get(it.source.file).push(it.source.name);
  }
  const rcValues = {};
  const rcFor = (file) => (rcValues[file] ??= readRc(file, rcNames.get(file) || [], env));
  const rcOf = (src) => (src.type === 'rc' ? { [src.file]: rcFor(src.file) } : {});
  const plan = [];
  for (const it of sel.items) {
    const allowed = new Set(it.replace || []);
    const units =
      it.kind === 'env'
        ? [{ name: it.name, kind: 'env', get: () => readValue(it.source, env, rcOf(it.source)) }]
        : it.files.map((f) => ({ name: f.name, kind: 'file', path: f.path, get: () => fileContent(f, { home: sel.home, ghToken: sel.ghToken }) }));
    for (const u of units) {
      const r = { id: it.id, name: u.name, kind: u.kind, path: u.path };
      results.push(r);
      // A file's path first: the Vault holds one file item per path, so whoever writes it is the one replaced.
      const old = (u.path && byPath.get(u.path)) || byName.get(u.name);
      if (old && !ours.has(old.name) && !allowed.has(old.name)) {
        r.status = 'kept';
        r.detail = `already in your Vault as ${old.name} (${old.kind}${old.path ? ` ~/${old.path}` : ''}, selector ${selectorString(old.selector)}), set some other way since the plan was written: left unchanged`;
        log(`kept   ${u.name}: ${r.detail}`);
        continue;
      }
      // A file item already writing this path under another name is replaced under its own name:
      // the Vault allows one file item per path, so a second name would be refused.
      if (old && u.path && old.path === u.path && old.name !== u.name) {
        u.name = old.name;
        r.name = old.name;
      }
      const got = u.get();
      const value = got.error ? null : got.value ?? got.text;
      if (got.error || value === '' || value == null) {
        r.status = 'failed';
        r.detail = got.error || 'empty';
        log(`failed ${u.name} (${u.kind}): ${r.detail}`);
        continue;
      }
      const sent = u.kind === 'env' ? value.replace(/\n$/, '') : value;
      r.bytes = Buffer.byteLength(sent);
      if (r.bytes > VAULT_MAX_VALUE) {
        r.status = 'failed';
        r.detail = `${r.bytes} bytes: over the Vault's 64 KiB per item`;
        log(`failed ${u.name} (${u.kind}): ${r.detail}`);
        continue;
      }
      plan.push({ r, u, old, sent });
    }
  }

  // 2. The quotas: what stays in the Vault plus what this run sets.
  const replacing = new Set(plan.filter((p) => p.old).map((p) => p.old.name));
  const staying = vault.filter((v) => !replacing.has(v.name));
  const nItems = staying.length + plan.length;
  const nBytes = staying.reduce((s, v) => s + (v.size || 0), 0) + plan.reduce((s, p) => s + p.r.bytes, 0);
  const totals = { items: nItems, maxItems, bytes: nBytes, maxBytes };
  if (nItems > maxItems || nBytes > maxBytes) {
    const big = [...plan].sort((a, b) => b.r.bytes - a.r.bytes).slice(0, 8);
    log(
      `over the Vault's limits, nothing written: ${nItems} items of ${maxItems}, ${human(nBytes)} of ${human(maxBytes)}. ` +
        `Biggest: ${big.map((p) => `${p.u.name} ${human(p.r.bytes)}`).join(', ')}. Uncheck some in the plan, or remove items you no longer need (instabox vault rm NAME).`,
    );
    return { ok: false, code: 3, results, totals };
  }

  // 3. Write.
  let ok = !results.some((r) => r.status === 'failed');
  const where = Object.keys(selector).length ? `boxes with ${selectorString(selector)}` : 'every box';
  for (const { r, u, sent } of plan) {
    const what = `${u.name} (${u.kind}${u.path ? ` ~/${u.path}` : ''}, ${r.bytes} bytes) for ${where}`;
    if (dryRun) {
      r.status = 'would set';
      log(`would set ${what}`);
      continue;
    }
    const argv =
      u.kind === 'env'
        ? [instabox, 'vault', 'set', u.name, ...selFlag]
        : [instabox, 'vault', 'set-file', u.path, '--name', u.name, ...selFlag];
    // env items: the CLI drops one trailing newline from stdin, so send exactly one.
    const p = run(argv, { env, input: u.kind === 'env' ? sent + '\n' : sent });
    if (p.ok) {
      r.status = 'set';
      log(`set    ${what}`);
    } else {
      ok = false;
      r.status = 'failed';
      r.detail = mask(p.stderr || p.stdout, sent);
      log(`failed ${u.name} (${u.kind}): ${r.detail}`);
    }
  }
  if (!dryRun) {
    const set = new Map(manifest.items.map((m) => [m.name, m]));
    for (const { r } of plan) if (r.status === 'set') set.set(r.name, { name: r.name, kind: r.kind, ...(r.path ? { path: r.path } : {}) });
    // Forget names that are gone from the Vault (removed by hand since).
    const live = new Set([...vault.map((v) => v.name), ...plan.filter((p) => p.r.status === 'set').map((p) => p.r.name)]);
    writeManifest(manifestPath, [...set.values()].filter((m) => live.has(m.name)).sort((a, b) => (a.name < b.name ? -1 : 1)));
  }
  return { ok, code: ok ? 0 : 1, results, totals };
}

function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--selection');
  if (i < 0 || !args[i + 1]) {
    process.stderr.write('usage: push.mjs --selection selection.json [--dry-run]\n');
    process.exit(2);
  }
  const dryRun = args.includes('--dry-run');
  const sel = JSON.parse(readFileSync(args[i + 1], 'utf8'));
  const { code, results, totals } = push(sel, { dryRun, instabox: process.env.INSTABOX_BIN || 'instabox' });
  const n = (s) => results.filter((r) => r.status === s).length;
  console.log(
    `\n${dryRun ? `${n('would set')} would be set` : `${n('set')} set`}, ${n('kept')} left as they were, ${n('failed')} failed${dryRun ? ' (dry run)' : ''}.`,
  );
  if (totals) console.log(`Vault after this: ${totals.items} of ${totals.maxItems} items, ${human(totals.bytes)} of ${human(totals.maxBytes)}.`);
  if (sel.leftover?.length) console.log(`Still in your Vault from an earlier run, unchecked now: ${sel.leftover.join(' ')} (remove with instabox vault rm NAME).`);
  process.exit(code);
}

if (isMain(import.meta)) main();
