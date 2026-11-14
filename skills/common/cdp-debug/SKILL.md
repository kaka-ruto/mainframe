---
name: cdp-debug
description: >-
  Debug JavaScript errors in kawibot (or any localhost Rails app) by connecting to Chrome via CDP remote debugging.
  Use when the user reports browser console errors, SyntaxError, module import failures, custom element registration issues,
  or any frontend JS bug that isn't visible in the page source. Also use when the IAB can't access auth-protected pages
  or when full console/network capture is needed during page load.
---

# CDP Browser Debugging

Use this skill to connect to a user's Chrome instance via the Chrome DevTools Protocol (CDP) and inspect console errors, network requests, module scripts, and custom element registration.

## Prerequisites

- `playwright` must be installed globally: `npm install -g playwright`
- Chrome must be running with `--remote-debugging-port=9222`
- The `chrome-debug` script at `~/.local/bin/chrome-debug` handles launching Chrome with the right flags

## Workflow

### 1. Launch Chrome with debugging (if not already running)

Run the chrome-debug script. It kills any stale Chrome, starts a fresh instance with the debugging port, and waits for the port to be ready:

```bash
chrome-debug
```

The user should then log into kawibot/kawifiles in that Chrome window.

### 2. Connect via Playwright CDP

```js
import { chromium } from "playwright";
const browser = await chromium.connectOverCDP("http://localhost:9222");
const ctx = browser.contexts()[0];
const page = await ctx.newPage();
```

Note: `import { chromium } from "playwright"` works because `playwright` is installed globally. If the Node REPL can't find it, use the full path:
```js
import { chromium } from "/Users/kaka/.asdf/installs/nodejs/22.11.0/lib/node_modules/playwright/index.mjs";
```

### 3. Set up error capture BEFORE navigating

```js
const pageErrors = [];
const consoleErrors = [];
page.on("pageerror", err => {
  pageErrors.push({ message: err.message, stack: err.stack?.slice(0, 2000) });
});
page.on("console", msg => {
  if (msg.type() === "error" || msg.type() === "warning") {
    consoleErrors.push({ type: msg.type(), text: msg.text() });
  }
});
```

### 4. Navigate to the page and inspect

```js
await page.goto("http://localhost:3000/kawifiles/work_requests/79", { waitUntil: "load" });
await page.waitForTimeout(2000);
```

### 5. Check module scripts for syntax errors

This is critical — many import-related errors come from malformed inline module scripts:

```js
const modTexts = await page.locator('script[type="module"]').allTextContents();
// Check for any import statements that look wrong, especially
// imports containing JSON/hash syntax from Rails helpers
```

**Common issue:** Rails `javascript_import_module_tag` with string-key hashes generates invalid imports:
```javascript
// BROKEN — string keys become positional args:
import "@ask-rb/ask-ui-kit"
import "{"data-turbo-track": "reload"}"   // ← SyntaxError!
```

### 6. Check custom element registration

If using Lit/Web Components, verify the custom elements are registered:

```js
const hasMsg = await page.evaluate(() => !!customElements.get("ask-message"));
const hasThink = await page.evaluate(() => !!customElements.get("ask-thinking"));
```

### 7. Count elements in DOM

```js
const count = await page.locator("ask-message").count();
```

### 8. Check content attributes for HTML escaping issues

```js
const content = await page.locator("ask-message").first().getAttribute("content");
```

If content has `\"` sequences, `escape_javascript` was used instead of `html_escape` for HTML attribute values.

### 9. Check network for failed resource loads

```js
const requests = [];
page.on("request", req => {
  if (req.url().includes("ask-ui") || req.url().includes(".js")) {
    requests.push({ url: req.url(), type: req.resourceType() });
  }
});
// Then reload:
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(2000);
```

### 10. Report findings

Summarize:
- Console errors (type, message)
- Page errors (message, stack first line)
- Module script contents (especially for import syntax errors)
- Custom element registration status
- Component element counts

## Common issues in kawibot

| Error | Likely Cause | Fix |
|---|---|---|
| `Unexpected identifier 'data'` | Rails `javascript_import_module_tag` with string-key hash like `"data-turbo-track": "reload"` generating `import "{\"data-turbo-track\":...}"` | Remove the hash or use symbol keys |
| Custom elements not registered but DOM has the tags | Module script import failed silently (see step 5) | Check import syntax in generated HTML |
| Double quotes in content break HTML | `escape_javascript` used in HTML attribute instead of `html_escape` | Use `<%= message.content %>` (default html_escape) not `escape_javascript` |
