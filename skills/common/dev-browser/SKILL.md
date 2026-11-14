---
name: dev-browser
description: Drive the user's Chrome (or a headless Chromium) with sandboxed JavaScript scripts for browser/UI tasks — clicking, filling forms, reading pages, taking screenshots. Use whenever a task needs the real browser (logged-in sessions, dashboards, local apps), especially when the in-app browser lacks the login or is too flaky. Requires the dev-browser CLI (npm install -g dev-browser).
---

# Dev Browser usage

Control browsers from sandboxed JS scripts piped to `dev-browser`. Pages
are **full Playwright Page objects** (goto, click, fill, locator,
getByRole/getByText/getByPlaceholder, evaluate, screenshot, keyboard,
mouse — confirmed in the package README and daemon source).

## Connect to the user's Chrome

Chrome runs with `--remote-debugging-port=9222`; attach and keep the
user's logins:

```bash
dev-browser --connect http://localhost:9222 <<'EOF'
const pages = await browser.listPages();
console.log(JSON.stringify(pages.map((p) => ({url: p.url, title: p.title}))));
EOF
```

`browser.getPage(id)` binds an existing tab (use the id from
`listPages()`); `browser.newPage()` creates one. Tabs persist between
script runs; `browser.closePage(name)` closes.

## CRITICAL: every script is hard-capped at 30 seconds

The daemon kills any script that runs longer than
`SCRIPT_TIMEOUT_MS = 3e4` (30s, hard-coded, no override flag — verified
in the daemon bundle). Consequences:

- **Split long operations into multiple short scripts.** Never put
  `waitForTimeout(5000)` loops, multi-step flows with waits, or big
  `innerText()` dumps on huge pages into one script.
- Do one state-changing action per script; check the result in the next.
- If the page needs time to render, `sleep N` in bash between scripts
  instead of waiting inside the script.
- A killed script can leave the daemon busy: later scripts time out too.
  Recover with `dev-browser stop` (restarts the daemon; with `--connect`
  the user's Chrome is unaffected), then reconnect.

## Sandbox limits

QuickJS WASM sandbox — no `require`/`import`, no `process`, `fs`,
`fetch`, or `WebSocket`. Top-level `await` works; `console.log` goes to
stdout. File I/O is restricted to `~/.dev-browser/tmp/` via
`saveScreenshot(buf, name)` (returns the path — then read that file with
the Read tool) and `writeFile`/`readFile`.

## Playwright notes that bite

- `getByRole` can fail with "pointer probe returned no click point" on
  shadow-DOM dashboards (Cloudflare). `page.locator("text=...")` and
  `[role=row]` + hasText scoping usually still work.
- Pass explicit small timeouts (`{ timeout: 5000 }`) — the default is
  also ~30s and burns the script budget.
- `evaluate()` is read-only; don't mutate DOM inside it.

## Installation

```bash
npm install -g dev-browser
dev-browser install
```

Named daemon-launched browsers persist by default. For unattended work, `--idle-timeout 5m` closes each launched browser after inactivity while preserving its profile and login state. The setting never closes Chrome attached with `--connect`; use `--idle-timeout 0` to disable configured cleanup.
