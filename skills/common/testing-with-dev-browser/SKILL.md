---
name: testing-with-dev-browser
description: Use when validating real browser behavior with dev-browser, especially for page flows, selector discovery, visual checks, flaky browser interactions, or recovery after a failed browser script
---

# Testing With Dev Browser

## Overview

`dev-browser` is a CLI wrapper around a sandboxed JavaScript runner with a preconnected `browser` object. Pages returned by `browser.getPage()` behave like Playwright `Page` objects, so the reliable path is: inspect the page, take one action, wait explicitly, then log proof.

Commands: `run`, `install` (install Chromium), `install-skill`, `browsers`, `status`, `stop`

Key flags: `--browser <name>` (persistent sessions), `--headless`, `--timeout <secs>`, `--connect` (attach to existing Chrome), `--idle-timeout <duration>` (auto-close idle browsers), `--ignore-https-errors`

**Core principle:** keep scripts short, stateful, and observable.

## When to Use

- Verifying a real webpage or local web app in a browser
- Reproducing or checking a UI flow step by step
- Discovering unknown elements before interacting
- Saving screenshots or structured browser evidence for handoff
- Reconnecting to a failed browser state instead of restarting from scratch

Do not use this skill for pure HTTP/API checks or work that does not need a browser.

## What `dev-browser` Gives You

- A sandboxed QuickJS runtime, not Node.js
- A global `browser` object
- Full Playwright `Page` APIs on pages from `browser.getPage()` and `browser.newPage()`
- Persistent named pages when you use `browser.getPage("name")`
- Separate browser state per `--browser <name>`
- Optional attachment to an existing Chrome via `--connect`
- `saveScreenshot()`, `writeFile()`, and `readFile()` inside `~/.dev-browser/tmp`

## Key Constraints

- No `require`, `import`, `process`, `fetch`, `fs`, or direct host access
- Inside `page.evaluate(...)`, write plain JavaScript only
- Long or optimistic scripts are brittle; timeouts kill them

## Reliable Workflow

1. Pick a stable browser name for the task.
2. Pick stable page names for important surfaces like `login`, `checkout`, or `results`.
3. Keep each script focused on one job: inspect, act, or verify.
4. If the page is unfamiliar, use `snapshotForAI()` before choosing selectors.
5. If the page is familiar, use direct Playwright selectors and role locators.
6. Wait explicitly for the state change you expect with `waitForSelector()` or `waitForURL()`.
7. End every script with structured output that proves the current state.
8. If a step fails, reconnect to the same named page and capture screenshot, URL, and title.

## Default Operating Patterns

### 1. Start with a short timeout

Use `--timeout 10` or `--timeout 15` by default. A missing selector can otherwise burn the full timeout before failing.

```bash
dev-browser --browser my-check --headless --timeout 10 <<'EOF'
const page = await browser.getPage('main');
await page.goto('https://example.com');
console.log(JSON.stringify({
  url: page.url(),
  title: await page.title()
}, null, 2));
EOF
```

### 2. Use named pages, not anonymous pages

Named pages persist across runs, which makes retries and debugging much easier.

```bash
dev-browser --browser my-check --headless --timeout 10 <<'EOF'
const page = await browser.getPage('checkout');
console.log(page.url());
EOF
```

Prefer `browser.newPage()` only for throwaway probes.

### 3. Inspect first when the DOM is unknown

Use `snapshotForAI()` to discover accessible structure and likely locators.

```bash
dev-browser --browser my-check --headless --timeout 10 <<'EOF'
const page = await browser.getPage('main');
const snap = await page.snapshotForAI({ track: 'main', depth: 2, timeout: 5000 });
console.log(snap.full);
EOF
```

After the page changes, run another snapshot with the same `track` value.

### 4. Interact only after you know the target

Prefer role locators or stable selectors over brittle text scraping.

```bash
dev-browser --browser my-check --headless --timeout 10 <<'EOF'
const page = await browser.getPage('main');
await page.getByRole('link', { name: 'Learn more' }).click();
await page.waitForURL('**iana.org/**');
console.log(JSON.stringify({ url: page.url() }, null, 2));
EOF
```

### 5. End with proof, not interpretation

Always log the facts needed for the next decision.

```bash
dev-browser --browser my-check --headless --timeout 10 <<'EOF'
const page = await browser.getPage('results');
console.log(JSON.stringify({
  url: page.url(),
  title: await page.title(),
  heading: await page.textContent('h1')
}, null, 2));
EOF
```


### 6. Vision workflow (`page.cua`) — coordinate-based interaction

Use when selectors are unreliable but visual structure is clear. Take a screenshot, read the image to find coordinates, then click.

```bash
dev-browser --browser my-check --headless --timeout 10 <<'EOF'
const page = await browser.getPage('checkout');
const shot = await page.cua.screenshot();
console.log(JSON.stringify(shot));
EOF
```

```bash
dev-browser --browser my-check --headless --timeout 10 <<'EOF'
const page = await browser.getPage('checkout');
await page.cua.click({ x: 412, y: 233 });
console.log(page.url());
EOF
```

Also: `cua.doubleClick()`, `cua.drag()`, `cua.move()`, `cua.scroll()`, `cua.keypress()`, `cua.type()`.

### 7. DOM ID workflow (`page.domCua`)

Snapshot visible elements, then act by node id.

```bash
dev-browser --browser my-check --headless --timeout 10 <<'EOF'
const page = await browser.getPage('checkout');
console.log(await page.domCua.getVisibleDom());
EOF
```

```bash
dev-browser --browser my-check --headless --timeout 10 <<'EOF'
const page = await browser.getPage('checkout');
await page.domCua.click({ nodeId: 2 });
console.log(page.url());
EOF
```

### 8. File I/O between steps

```bash
dev-browser --browser my-check --headless --timeout 10 <<'EOF'
const path = await writeFile('data.json', JSON.stringify({items:[1,2,3]}));
console.log(path);
EOF
```

```bash
dev-browser --browser my-check --headless --timeout 10 <<'EOF'
const data = JSON.parse(await readFile('data.json'));
console.log('Read ' + (data.items || []).length + ' items');
EOF
```

### 9. Dev server navigation

For local dev servers (Rails, Vite), prefer `domcontentloaded` to avoid HMR hangs:

```bash
dev-browser --browser my-check --headless --timeout 10 <<'EOF'
const page = await browser.getPage('app');
await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
console.log(await page.title());
EOF
```


## Choose the Right Mode

### Managed browser

Use the default daemon-managed browser when you want an isolated, repeatable session.

```bash
dev-browser --browser my-check --headless <<'EOF'
const page = await browser.getPage('main');
EOF
```

### Existing Chrome

Use `--connect` when the user already has a browser state worth attaching to.

```bash
dev-browser --connect <<'EOF'
const tabs = await browser.listPages();
console.log(JSON.stringify(tabs, null, 2));
EOF
```

If needed, connect to a specific CDP endpoint:

```bash
dev-browser --connect http://localhost:9222 <<'EOF'
const page = await browser.getPage('main');
console.log(await page.title());
EOF
```

## Debugging and Recovery

When a script fails, do not immediately restart the flow. Reconnect to the same named page and inspect its state.

```bash
dev-browser --browser my-check --headless --timeout 10 <<'EOF'
const page = await browser.getPage('checkout');
const screenshot = await saveScreenshot(await page.screenshot(), 'checkout-debug.png');
console.log(JSON.stringify({
  screenshot,
  url: page.url(),
  title: await page.title()
}, null, 2));
EOF
```

Useful recovery checks:

- `browser.listPages()` to find page IDs, titles, URLs, and names
- `page.snapshotForAI()` when the DOM changed in an unexpected way
- `saveScreenshot()` when layout or visibility matters

## Waiting Rules

- Wait for what the user can observe, not what you hope happened
- Use `waitForSelector()` before reading content from async regions
- Use `waitForURL()` after clicks that navigate
- For form submissions, wait for the success region, error region, or resulting URL
- Avoid blind sleeps unless there is no better observable signal

## Good Script Shape

```bash
dev-browser --browser my-check --headless --timeout 10 <<'EOF'
const page = await browser.getPage('login');
await page.goto('https://example.com/login');
await page.fill('input[name="email"]', 'person@example.com');
await page.getByRole('button', { name: 'Continue' }).click();
await page.waitForSelector('[data-test="login-success"]');
console.log(JSON.stringify({
  url: page.url(),
  successText: await page.textContent('[data-test="login-success"]')
}, null, 2));
EOF
```

This is good because it does one flow, waits explicitly, and ends with evidence.

## Common Mistakes

- Writing one giant script for an entire journey instead of checkpointed steps
- Clicking unknown selectors before inspecting the page
- Forgetting `--timeout`, then waiting too long on bad assumptions
- Restarting from scratch instead of reusing a named page
- Logging prose instead of JSON facts
- Using screenshots alone when a DOM snapshot would identify the next action faster
- Using `page.evaluate(...)` with TypeScript syntax or unavailable globals

## Quick Checklist

- Did I choose a stable `--browser` name?
- Did I use named pages for resumable state?
- Is this script doing only one job?
- If the page is unknown, did I snapshot first?
- Did I wait for the exact state change I expect?
- Did I end with URL, title, text, screenshot path, or other proof?
- If it failed, did I reconnect and inspect before retrying?
