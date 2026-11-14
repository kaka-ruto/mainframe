#!/usr/bin/env node
// The checkbox plan between the scan and the push.
//
//   node plan.mjs write --scan scan.json --vault vault.json [--selector k=v,...] > plan.md
//   node plan.mjs parse --scan scan.json --vault vault.json plan.md > selection.json
//
// vault.json is `instabox vault ls --json`: items already in the Vault. One
// set there by an earlier run of this skill (listed in the manifest, see
// push.mjs) is replaced; one set any other way is unchecked, and checking it
// replaces it.
//
// `parse` reads the plan back strictly: every id exactly once, nothing
// unknown, no malformed checkbox. Errors go to stderr, all at once, exit 1.
// Over the Vault's limits: exit 3, with the sizes.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileContent } from './content.mjs';
import {
  VAULT_MAX_ITEMS,
  VAULT_MAX_TOTAL,
  VAULT_MAX_VALUE,
  human,
  isMain,
  parseSelector,
  selectorString,
} from './lib.mjs';

export const MANIFEST = join(homedir(), '.config', 'instabox-basic-setup', 'pushed.json');

export function readManifest(path = MANIFEST) {
  try {
    const m = JSON.parse(readFileSync(path, 'utf8'));
    return Array.isArray(m.items) ? m : { items: [] };
  } catch {
    return { items: [] };
  }
}

const SECTIONS = [
  ['tokens', 'Tokens', 'Environment variables, on tmpfs in the box (gone at a stop, back at the next start; never in a snapshot). Values go from this machine straight into the Vault and are never shown.'],
  ['git', 'Git', 'Files in the box’s home, written at every start and resume.'],
  ['editor', 'Editor and terminal', 'Files in the box’s home, written at every start and resume.'],
];

// Vault names an item writes: env name, or each file's item name.
const vaultNames = (it) => (it.kind === 'env' ? [it.name] : it.files.map((f) => f.name));

// What is in the Vault already under one of this item's names or paths: [{vault item, ours}].
export function existingFor(it, vault, manifest) {
  const ours = new Set((manifest?.items || []).map((m) => m.name));
  const found = [];
  const names = new Set(vaultNames(it));
  const paths = new Set(it.kind === 'file' ? it.files.map((f) => f.path) : []);
  for (const v of vault || []) {
    if (names.has(v.name) || (v.path && paths.has(v.path))) found.push({ item: v, ours: ours.has(v.name) });
  }
  return found;
}

export function planDigest(scan, vault, manifest) {
  const v = (vault || []).map((i) => [i.name, i.kind, i.path || '', selectorString(i.selector)]).sort();
  const m = (manifest?.items || []).map((i) => i.name).sort();
  return createHash('sha256').update(JSON.stringify([scan, v, m])).digest('hex').slice(0, 16);
}

// The default checkbox: the scan's, except that something set in the Vault some other way stays unless checked.
function defaults(scan, vault, manifest) {
  return scan.items.map((it) => {
    const ex = existingFor(it, vault, manifest);
    const theirs = ex.filter((e) => !e.ours);
    return { it, ex, theirs, checked: it.checked && !theirs.length };
  });
}

export function writePlan(scan, { vault = [], manifest = { items: [] }, selector = {} } = {}) {
  const h = scan.home;
  const out = [];
  out.push('# instabox basic setup: plan', '');
  out.push(
    'Check `[x]` what goes into your instabox Vault and uncheck `[ ]` what stays out.',
    'Do not edit the ids in backticks or delete lines: the agent reads this file back and stops on anything it does not recognise.',
    '',
    'The selector says which of your boxes get these items: `*` is every box, the ones you create later included;',
    '`key=value` (comma-separated for more) only boxes with that metadata (`instabox create --meta key=value`).',
    '',
    `Selector: \`${selectorString(selector)}\``,
    '',
    `<!-- plan ${planDigest(scan, vault, manifest)}: written from this scan and Vault; scan again and write a new plan if either changed -->`,
  );
  const rows = defaults(scan, vault, manifest);
  for (const [key, title, blurb] of SECTIONS) {
    out.push('', `## ${title}`, '', blurb, '');
    const mine = rows.filter((r) => r.it.section === key);
    if (!mine.length) out.push('_Nothing found._');
    for (const { it, ex, theirs, checked } of mine) {
      let text;
      if (it.kind === 'env') text = `${it.name} from ${it.from}`;
      else if (it.files.length === 1) text = `~/${it.path} · ${human(it.bytes)}`;
      else text = `~/${it.path}/: ${it.files.length} files · ${human(it.bytes)}`;
      if (it.reason) text += ` · off by default: ${it.reason}`;
      if (it.note) text += ` · ${it.note}`;
      if (theirs.length)
        text += ` · already in your Vault as ${theirs.map((e) => e.item.name).join(', ')}, set some other way: checking this replaces it`;
      else if (ex.length) text += ' · replaces the copy from your last run';
      out.push(`- [${checked ? 'x' : ' '}] \`${it.id}\` ${text}`);
    }
  }
  out.push('', '## Can’t move: do these yourself', '');
  out.push('No checkbox: the agent repeats these at the end, with the command for each.', '');
  if (!scan.manual.length) out.push('_Nothing._');
  for (const m of scan.manual) out.push(`- ${m.what}: ${m.why}. ${m.todo}`);
  out.push('');
  return out.join('\n');
}

export class PlanError extends Error {
  constructor(errors, code = 1) {
    super(errors.join('\n'));
    this.errors = errors;
    this.code = code;
  }
}

// Reads the plan back. Throws PlanError listing every problem (code 1), or the limits (code 3).
export function parsePlan(scan, text, { vault = [], manifest = { items: [] }, limits = {} } = {}) {
  const maxItems = limits.maxItems || VAULT_MAX_ITEMS;
  const maxBytes = limits.maxBytes || VAULT_MAX_TOTAL;
  const errors = [];
  const byId = new Map(scan.items.map((i) => [i.id, i]));
  const state = new Map();
  let selector = null;
  let sawSelector = false;
  let digest = null;
  text.split('\n').forEach((raw, i) => {
    const n = i + 1;
    const l = raw.replace(/\r$/, '');
    const s = l.match(/^Selector:\s*(.*)$/);
    if (s && /^`/.test(s[1].trim())) {
      if (sawSelector) errors.push(`line ${n}: a second Selector: line`);
      sawSelector = true;
      const m = s[1].trim().match(/^`([^`]*)`$/);
      if (!m) errors.push(`line ${n}: write the selector in backticks: Selector: \`*\``);
      else
        try {
          selector = parseSelector(m[1]);
        } catch (e) {
          errors.push(`line ${n}: ${e.message}`);
        }
      return;
    }
    const d = l.match(/<!-- plan ([0-9a-f]+):/);
    if (d) digest = d[1];
    // Anything that looks like a list item with a checkbox must be exactly one of ours.
    if (!/^\s*(?:[-*+]|\d+[.)])\s*\[/.test(l) && !/^\s*[-*+]\s*`(?:env|file|files):/.test(l)) return;
    const m = l.match(/^- \[([ xX])\] `([^`]+)`(?: .*)?$/);
    if (!m) {
      errors.push(`line ${n}: not a checkbox line this plan understands: ${JSON.stringify(l.slice(0, 80))} (write "- [x] \`id\` ..." or "- [ ] \`id\` ...")`);
      return;
    }
    const [, mark, id] = m;
    if (!byId.has(id)) return errors.push(`line ${n}: unknown id \`${id}\``);
    if (state.has(id)) return errors.push(`line ${n}: \`${id}\` appears twice`);
    state.set(id, mark !== ' ');
  });
  if (!sawSelector) errors.push('no "Selector: `*`" line (write `*` for every box)');
  if (digest === null) errors.push('the "<!-- plan ... -->" line is missing: write the plan again');
  else if (digest !== planDigest(scan, vault, manifest))
    errors.push('this plan was written from a different scan or Vault: scan, list the Vault and write the plan again');
  for (const id of byId.keys()) if (!state.has(id)) errors.push(`\`${id}\` is missing from the plan (uncheck a line instead of deleting it)`);
  if (errors.length) throw new PlanError(errors);

  const picked = scan.items.filter((i) => state.get(i.id));
  // GH_TOKEN from this plan, or already in the Vault: either way gh's credential helper works.
  const ghToken =
    picked.some((i) => i.kind === 'env' && i.name === 'GH_TOKEN') || vault.some((v) => v.kind === 'env' && v.name === 'GH_TOKEN');
  const items = [];
  const sizes = [];
  for (const it of picked) {
    const ex = existingFor(it, vault, manifest);
    const out = { ...it, replace: ex.map((e) => e.item.name) };
    delete out.checked;
    if (it.kind === 'file') {
      out.files = it.files.map((f) => {
        const c = fileContent(f, { home: scan.home, ghToken });
        if (c.error) errors.push(`\`${it.id}\`: ${c.error}`);
        const bytes = c.error ? 0 : Buffer.byteLength(c.text);
        if (bytes > VAULT_MAX_VALUE) errors.push(`\`${it.id}\`: ~/${f.path} is ${human(bytes)}, over the Vault's 64 KiB per item: uncheck it`);
        if (!c.error && !bytes) errors.push(`\`${it.id}\`: ~/${f.path} is empty, and the Vault takes no empty file: uncheck it`);
        return { ...f, bytes };
      });
      out.bytes = out.files.reduce((s, f) => s + f.bytes, 0);
    }
    sizes.push({ id: it.id, items: vaultNames(it).length, bytes: out.bytes || 0 });
    items.push(out);
  }
  if (errors.length) throw new PlanError(errors);

  // The Vault's quotas count every item of the user, so what stays there counts too.
  const replaced = new Set(items.flatMap((i) => i.replace));
  const staying = vault.filter((v) => !replaced.has(v.name));
  const stayBytes = staying.reduce((s, v) => s + (v.size || 0), 0);
  const nItems = staying.length + sizes.reduce((s, x) => s + x.items, 0);
  const nBytes = stayBytes + sizes.reduce((s, x) => s + x.bytes, 0);
  const vaultUse = { items: nItems, maxItems, fileBytes: nBytes, maxBytes, staying: staying.length, stayingBytes: stayBytes };
  if (nItems > maxItems || nBytes > maxBytes) {
    const big = [...sizes].sort((a, b) => b.bytes - a.bytes || b.items - a.items).slice(0, 8);
    throw new PlanError(
      [
        `over the Vault's limits: ${nItems} items of ${maxItems}, ${human(nBytes)} of ${human(maxBytes)} (tokens not counted yet), ${staying.length} items (${human(stayBytes)}) of them already in your Vault and staying.`,
        `the biggest checked lines: ${big.map((b) => `\`${b.id}\` ${b.items} item${b.items === 1 ? '' : 's'}, ${human(b.bytes)}`).join('; ')}`,
        'uncheck some, or remove Vault items you no longer need (`instabox vault ls`, `instabox vault rm NAME`)',
      ],
      3,
    );
  }

  const ours = new Set((manifest.items || []).map((m) => m.name));
  const pickedNames = new Set(items.flatMap(vaultNames));
  return {
    version: 2,
    home: scan.home,
    selector,
    ghToken,
    items,
    manual: scan.manual,
    skipped: scan.items.filter((i) => !state.get(i.id)).map((i) => i.id),
    // From an earlier run and not in this plan any more: left in the Vault, listed in the report.
    leftover: (manifest.items || []).filter((m) => !pickedNames.has(m.name) && vault.some((v) => v.name === m.name)).map((m) => m.name),
    vault: vaultUse,
    ours: [...ours],
  };
}

function readVault(file) {
  const v = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(v.items)) throw new Error(`${file}: not \`instabox vault ls --json\` output`);
  return v.items;
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const opt = (name) => {
    const i = rest.indexOf(name);
    if (i < 0) return undefined;
    const v = rest[i + 1] ?? '';
    rest.splice(i, 2);
    return v;
  };
  const usage = () => {
    process.stderr.write(
      'usage: plan.mjs write --scan scan.json --vault vault.json [--selector k=v,...] [--manifest FILE]\n' +
        '       plan.mjs parse --scan scan.json --vault vault.json [--limits limits.json] [--manifest FILE] plan.md\n',
    );
    process.exit(2);
  };
  const scanFile = opt('--scan');
  const vaultFile = opt('--vault');
  const manifest = readManifest(opt('--manifest') || MANIFEST);
  if (!scanFile || !vaultFile) usage();
  const scan = JSON.parse(readFileSync(scanFile, 'utf8'));
  const vault = readVault(vaultFile);
  if (cmd === 'write') {
    let selector = {};
    const s = opt('--selector');
    try {
      if (s !== undefined) selector = parseSelector(s);
    } catch (e) {
      process.stderr.write(e.message + '\n');
      process.exit(2);
    }
    if (rest.length) usage();
    process.stdout.write(writePlan(scan, { vault, manifest, selector }));
  } else if (cmd === 'parse') {
    const lf = opt('--limits');
    if (rest.length !== 1) usage();
    let limits = {};
    if (lf) {
      try {
        limits = JSON.parse(readFileSync(lf, 'utf8')) || {};
      } catch {}
    }
    try {
      const sel = parsePlan(scan, readFileSync(rest[0], 'utf8'), { vault, manifest, limits });
      process.stdout.write(JSON.stringify(sel, null, 2) + '\n');
    } catch (e) {
      if (!(e instanceof PlanError)) throw e;
      process.stderr.write(`${rest[0]}: ${e.code === 3 ? 'too big' : `${e.errors.length} problem(s)`}:\n${e.errors.map((x) => `  ${x}`).join('\n')}\n`);
      process.exit(e.code);
    }
  } else usage();
}

if (isMain(import.meta)) main();
