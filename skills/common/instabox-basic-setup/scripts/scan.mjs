#!/usr/bin/env node
// Read-only inventory of the basic setup that can go into the instabox Vault:
// tokens (by name and place, never values), git config, editor and terminal
// config. Prints JSON.
//
//   node scan.mjs > scan.json
//
// Nothing is written. Shell files are read for the names of the variables
// they export, never their values.
import { realpathSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
  MACOS_ONLY,
  SECRET_VALUE,
  VAULT_MAX_VALUE,
  WELL_KNOWN,
  hasCommand,
  isMain,
  isSecretName,
  listFiles,
  readText,
  run,
  statOrNull,
  vaultEnvNameOK,
  vaultFileName,
  vaultPathOK,
} from './lib.mjs';

// Shell startup files: read for exported tokens only. They do not move.
export const SHELL_RC = ['.zshenv', '.zprofile', '.zshrc', '.bash_profile', '.bash_login', '.profile', '.bashrc', '.bash_aliases'];

// nvim: config files only. Plugin managers' checkouts and editor state stay behind.
const NVIM_SKIP = new Set(['.git', 'node_modules', 'pack', 'plugged', 'bundle', 'site', 'undo', 'backup', 'swap', 'sessions', 'spell', '.repro']);
const NVIM_MAX_FILES = 40;
const NVIM_MAX_BYTES = 128 * 1024;

// `export NAME=value` / `NAME=value` lines of a shell file: names, line numbers and flags only.
function shellAssignments(text) {
  const out = [];
  text.split('\n').forEach((line, i) => {
    const m = line.match(/^\s*(?:export\s+|declare\s+-x\s+|typeset\s+-x\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) return;
    out.push({ name: m[1], line: i + 1, secretValue: SECRET_VALUE.test(m[2]), keychain: MACOS_ONLY.test(m[2]) });
  });
  return out;
}

function scanTokens({ home, env, procEnv }) {
  const items = [];
  const manual = [];
  const byName = new Map();
  const add = (name, source, from, extra = {}) => {
    if (byName.has(name)) return; // the first place a name is found wins: the Vault holds one value per name
    const item = { id: `env:${name}`, section: 'tokens', kind: 'env', name, source, from, checked: true, ...extra };
    byName.set(name, item);
    items.push(item);
  };
  const unvaultable = new Set();

  // gh: the token gh keeps (keychain or hosts.yml), read with `gh auth token` at push time.
  if (hasCommand('gh', env)) {
    const st = run(['gh', 'auth', 'status', '--hostname', 'github.com'], { env });
    if (st.ok) {
      const who = (st.stdout + st.stderr).match(/account (\S+)/)?.[1] || null;
      add('GH_TOKEN', { type: 'cmd', argv: ['gh', 'auth', 'token', '--hostname', 'github.com'] }, '`gh auth token`', {
        note: `${who ? `GitHub account ${who}; ` : ''}gh, and git over HTTPS to GitHub, use it on the box`,
      });
    }
  }

  // Shell startup files: exported tokens.
  for (const f of SHELL_RC) {
    const text = readText(join(home, f));
    if (text === null) continue;
    for (const a of shellAssignments(text)) {
      if (!WELL_KNOWN.has(a.name) && !isSecretName(a.name) && !a.secretValue) continue;
      if (!vaultEnvNameOK(a.name)) {
        if (!unvaultable.has(a.name)) {
          unvaultable.add(a.name);
          manual.push({
            what: `${a.name} (~/${f}:${a.line})`,
            why: 'the Vault does not take env items with this name (INSTABOX_*, SSH_* and a few system names)',
            todo: `if a box needs it, set it there by hand`,
          });
        }
        continue;
      }
      const extra = {};
      if (a.keychain) {
        extra.checked = false;
        extra.reason = 'your shell reads it from the macOS keychain: checking it runs that lookup once, at push time';
      } else if (!WELL_KNOWN.has(a.name)) {
        extra.checked = false;
        extra.reason = 'not a well-known model or service token: check it if every box should have it';
      }
      add(a.name, { type: 'rc', file: join(home, f), name: a.name }, `~/${f}:${a.line}`, extra);
    }
  }
  // Well-known tokens in the environment the scan runs in (set some other way than a shell file).
  for (const name of Object.keys(procEnv).sort()) {
    if (!WELL_KNOWN.has(name) || !procEnv[name]) continue;
    add(name, { type: 'env', name }, 'this shell’s environment');
  }

  if (!byName.has('GH_TOKEN'))
    manual.push({
      what: 'GitHub token (GH_TOKEN)',
      why: hasCommand('gh', env) ? 'gh is not signed in on this machine' : 'gh is not installed on this machine',
      todo: 'sign in here with `gh auth login` and run this again; or put a token in yourself: `instabox vault set GH_TOKEN` (it prompts without echo)',
    });
  if (!byName.has('CLAUDE_CODE_OAUTH_TOKEN'))
    manual.push({
      what: 'Claude Code sign-in (CLAUDE_CODE_OAUTH_TOKEN)',
      why: 'not found in your shell files; the sign-in on this machine is in the macOS keychain, and is never read',
      todo:
        'run `claude setup-token` yourself (it prints a token that lasts a year), then `instabox vault set CLAUDE_CODE_OAUTH_TOKEN` and paste it at the prompt' +
        (byName.has('ANTHROPIC_API_KEY') ? ' (or skip it: ANTHROPIC_API_KEY is in the plan, and Claude Code uses that)' : '; or `claude`, then /login, on each box'),
    });
  if (!byName.has('OPENAI_API_KEY') && (hasCommand('codex', env) || statOrNull(join(home, '.codex'))))
    manual.push({
      what: 'Codex sign-in',
      why: 'no OPENAI_API_KEY in your shell files; a ChatGPT sign-in cannot be copied (its refresh token rotates)',
      todo: 'on each box: `codex login --device-auth`; or `instabox vault set OPENAI_API_KEY` once for every box',
    });
  return { items, manual };
}

// A home-relative path for a file, or null when it is outside HOME or not one the Vault takes.
function homePath(home, p) {
  const rel = relative(home, p);
  return rel && !rel.startsWith('..') && vaultPathOK(rel) ? rel : null;
}

function fileEntry(home, section, rel, transform, extra = {}) {
  const src = join(home, rel);
  const st = statOrNull(src);
  if (!st?.isFile()) return null;
  const file = { path: rel, name: vaultFileName(rel), src, transform, bytes: st.size };
  const e = { id: `file:${rel}`, section, kind: 'file', path: rel, files: [file], bytes: st.size, checked: true, ...extra };
  if (st.size > VAULT_MAX_VALUE) {
    e.checked = false;
    e.reason = `${st.size} bytes: over the Vault's 64 KiB per item`;
  }
  return e;
}

function scanGit({ home, env }) {
  const out = [];
  const gc = fileEntry(home, 'git', '.gitconfig', 'gitconfig', {
    note: 'osxkeychain and other macOS-only lines, credentials and commit signing left out',
  });
  if (gc) out.push(gc);
  const xdg = fileEntry(home, 'git', '.config/git/config', 'gitconfig', { note: 'macOS-only lines and credentials left out' });
  if (xdg) out.push(xdg);
  // The global gitignore: core.excludesfile, else git's default.
  let ignore = null;
  const r = run(['git', 'config', '--global', '--get', 'core.excludesfile'], { env: { ...env, HOME: home } });
  const v = r.ok ? r.stdout.trim() : '';
  if (v) {
    const abs = v.startsWith('~/') ? join(home, v.slice(2)) : v.replace(/^\$HOME(?=\/)/, home);
    if (abs.startsWith('/')) ignore = homePath(home, abs);
  }
  if (!ignore && statOrNull(join(home, '.config/git/ignore'))) ignore = '.config/git/ignore';
  if (ignore) {
    const e = fileEntry(home, 'git', ignore, 'text', { note: 'your global gitignore' });
    if (e) out.push(e);
  }
  return out;
}

function scanEditor({ home }) {
  const out = [];
  for (const rel of ['.vimrc', '.tmux.conf', '.config/tmux/tmux.conf']) {
    const e = fileEntry(home, 'editor', rel, 'text');
    if (e) out.push(e);
  }
  // nvim: init.lua / init.vim and the config files around it, never plugin checkouts.
  const nvimDir = join(home, '.config', 'nvim');
  let real = nvimDir;
  try {
    real = realpathSync(nvimDir);
  } catch {}
  if (statOrNull(real)?.isDirectory()) {
    const files = [];
    const left = [];
    for (const f of listFiles(real, (n) => NVIM_SKIP.has(n))) {
      const top = !f.includes('/');
      const keep = /\.(?:lua|vim)$/.test(f) || (top && f === 'lazy-lock.json');
      if (!keep) continue;
      const rel = `.config/nvim/${f}`;
      const st = statOrNull(join(real, f));
      if (!vaultPathOK(rel) || !st) continue;
      if (st.size > VAULT_MAX_VALUE) {
        left.push(`${f} (${st.size} bytes)`);
        continue;
      }
      files.push({ path: rel, name: vaultFileName(rel), src: join(real, f), transform: f.endsWith('.json') ? 'raw' : 'text', bytes: st.size });
    }
    if (files.some((f) => /^\.config\/nvim\/init\.(?:lua|vim)$/.test(f.path))) {
      const bytes = files.reduce((s, f) => s + f.bytes, 0);
      const e = { id: 'files:.config/nvim', section: 'editor', kind: 'file', path: '.config/nvim', files, bytes, checked: true };
      const notes = ['plugins are not copied: your plugin manager installs them on the box'];
      if (left.length) notes.push(`left out, over 64 KiB: ${left.join(', ')}`);
      e.note = notes.join('; ');
      if (files.length > NVIM_MAX_FILES || bytes > NVIM_MAX_BYTES) {
        e.checked = false;
        e.reason = `${files.length} files: a big share of the Vault's 100 items and 256 KiB`;
      }
      out.push(e);
    }
  }
  return out;
}

// Two paths can map to one item name (a-b.lua and a/b.lua): the second gets -2, -3...
function uniqueNames(entries) {
  const used = new Set();
  for (const e of entries) {
    if (e.kind === 'env') used.add(e.name);
    for (const f of e.files || []) {
      let n = f.name;
      for (let i = 2; used.has(n); i++) n = `${f.name}-${i}`;
      f.name = n;
      used.add(n);
    }
  }
}

export function scan(opts = {}) {
  const env = opts.env || process.env;
  const home = resolve(opts.home || env.HOME);
  const tokens = scanTokens({ home, env, procEnv: opts.procEnv || env });
  const items = [...tokens.items, ...scanGit({ home, env }), ...scanEditor({ home })];
  uniqueNames(items);
  return { version: 2, home, platform: opts.platform || process.platform, items, manual: tokens.manual };
}

function main() {
  if (process.argv.length > 2) {
    process.stderr.write('usage: scan.mjs > scan.json\n');
    process.exit(2);
  }
  process.stdout.write(JSON.stringify(scan(), null, 2) + '\n');
}

if (isMain(import.meta)) main();
