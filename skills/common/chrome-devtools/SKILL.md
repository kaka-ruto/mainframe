---
name: chrome-devtools
description: >-
  Drive and inspect Google Chrome through the chrome-devtools MCP server
  (navigate, click, type, extract, screenshot, debug network/console,
  performance). Use whenever the user wants the agent to operate a web page or
  browser — "open X", "log in to Y", "click the button", "fill the form",
  "take a screenshot of this page", "check what's on this page", or any task
  involving the live browser — even if they don't explicitly mention the
  browser.
---

# Chrome DevTools (browser control)

The `chrome_devtools` MCP server gives you hands on a real Google Chrome
instance. The core loop is **observe → act → verify**: take a snapshot, act on
an element, then confirm the page changed as intended. Work in small steps —
never fire a click into a page you haven't looked at.

## Connection modes

The server connects to Chrome in one of two ways. Figure out which one is
active before doing anything sensitive:

- **Managed Chrome (default):** the server launched its own Chrome with a
  dedicated profile at `~/.cache/chrome-devtools-mcp/chrome-profile`. Logins
  made in this browser persist across sessions, but it is a *separate*
  browser — the user's normal Chrome and its sessions are not touched.
- **Attach mode (`--browserUrl`):** the server connects to whatever Chrome is
  listening on `127.0.0.1:9222`. With the `chrome-debug` helper that is a
  **dedicated Chrome-Debug profile**
  (`~/Library/Application Support/Google/Chrome-Debug`) — the user's accounts
  may be logged in there (they log in once, agents reuse those sessions). It
  is still a separate profile from the user's everyday browser, but treat it
  carefully: those are real accounts, and you have full read/write access.

How to tell which mode: `list_pages` — in attach mode you'll see the user's
real tabs (dashboards, apps they left open); in managed mode only tabs the
agent created. When unsure, say which browser you're acting in.

## Core loop

1. **Observe.** `take_snapshot` on the current page to get the interactive
   elements and their `uid`s. (Prefer snapshots over screenshots — they are
   cheaper, more precise, and give you element IDs.)
2. **Act.** Use the smallest primitive that does the job: `navigate_page` for
   URLs, `click` by `uid`, `fill`/`fill_form` for inputs, `hover` before
   menus, `wait_for` when expecting text to appear.
3. **Verify.** Confirm the result: a new snapshot, `navigate_page_history`,
   the current URL, or `list_console_messages` for errors. If the page did
   not change as expected, snapshot again before retrying — don't blind-retry
   clicks.
4. **Repeat** until the task is done. Check in with the user for multi-step
   workflows that make changes.

## Tool reference (26 tools)

**Navigation & tabs**
- `navigate_page(url)` — go to a URL on the selected page.
- `navigate_page_history(navigate)` — back/forward (`"back"`/`"forward"`).
- `new_page(url)` — open a new tab.
- `select_page(pageIdx)` — switch the "selected page" for subsequent calls.
- `list_pages` — list open pages/tabs (call this first when unsure).
- `close_page(pageIdx)` — close a tab (the last open tab cannot be closed).

**Interaction** (all act on the *selected* page)
- `take_snapshot` — text snapshot of the page with `uid`s for every element.
  Your primary perception tool.
- `click(uid)` — click an element from a snapshot.
- `fill(uid, value)` — type into an input/textarea or pick a `<select>` option.
- `fill_form(elements)` — fill multiple fields in one call (map names to values).
- `hover(uid)` — hover (open menus/tooltips).
- `drag(from_uid, to_uid)` — drag-and-drop.
- `upload_file(uid, filePath)` — set a file input.
- `wait_for(text)` — block until text appears on the page (use instead of
  sleep-polling).
- `evaluate_script(function)` — run a JS function in the page, returns JSON.
  Use sparingly and only when the other tools can't express the action.
- `handle_dialog(action)` — accept/dismiss an alert/confirm/prompt.
- `resize_page(width, height)` — resize the page viewport.

**Perception & debugging**
- `take_screenshot` — pixel screenshot (for visual confirmation, pages with
  canvas/images, or when the user asks for one). More expensive than
  snapshots — don't default to it.
- `list_console_messages` — page console errors/warnings (check after
  navigation failures).
- `list_network_requests` / `get_network_request(url)` — inspect network
  traffic (API calls, failing requests).
- `emulate_network(throttlingOption)` / `emulate_cpu(throttlingRate)` —
  throttling for performance testing.

**Performance**
- `performance_start_trace(reload, autoStop)` / `performance_stop_trace` /
  `performance_analyze_insight(insightName)` — trace and analyze page load
  performance. Use only when the user asks about performance.

## Efficiency rules

- **Snapshot, don't screenshot** — `take_snapshot` is the default perception
  tool; `take_screenshot` only when visuals matter or the user asks.
- **One act per observation** — after each action, verify before the next.
- **Use `wait_for` instead of retry loops** — pages that load content
  dynamically will settle; wait for the expected text, then continue.
- **Don't re-snapshot the whole page repeatedly** — reuse the `uid`s from the
  last snapshot; re-snapshot only when the page changed.

## Security & etiquette

- **Read-only by default.** Prefer snapshots, navigation, and console/network
  inspection. For actions that change state (submitting forms, deleting,
  purchasing, sending messages), state what you're about to do and confirm
  with the user first.
- **Never enter passwords or credentials** unless the user explicitly asked
  you to, and never echo them into the conversation.
- **In attach mode**, every action happens in the user's real browser — a
  mistaken click can have real consequences. Say when you're about to act in
  their live browser vs. the managed one.

## Troubleshooting

- **Server not connected:** the MCP server didn't start (check the client's
  MCP settings; restart the session). Don't keep retrying tool calls.
- **No Chrome / connection refused (attach mode):** nothing is listening on
  `127.0.0.1:9222`. Tell the user to run the `chrome-debug` helper (starts
  their dedicated Chrome-Debug profile with remote debugging) and retry.
- **Dialogs blocking:** page opened an alert/confirm — `handle_dialog`.
- **Navigation failed:** `list_console_messages` and
  `list_network_requests` before retrying; the page may be down, blocked, or
  requiring login.
- **Element not found:** the page changed since your snapshot —
  `take_snapshot` again; content may be behind a `wait_for` or lazy-load.
