---
name: cloudflare-chrome
description: How to operate the MyrrLabs Cloudflare account — DNS records, tunnels, Worker routes — by driving the user's logged-in Chrome and using Cloudflare's Ask AI assistant instead of clicking through the dashboard. Use whenever the user asks to change Cloudflare DNS, tunnels, Workers, or certs, or mentions dev.myrrlabs.com, dev.anywaye.com, the anywaye tunnel, or the myrr-gateway Worker.
---

# Operating the Cloudflare account

## Golden rule: use Ask AI, not click-through

Cloudflare's dashboard is hostile to DOM automation: its shadow-DOM UI
breaks Playwright role locators with "pointer probe returned no click
point" errors, the cookie-consent dialog lingers in the DOM as a hidden
`[role=dialog]`, and the Save buttons are often disabled for automation.
The reliable path is **Cloudflare's own AI assistant**:

1. The user is logged into `https://dash.cloudflare.com` in Chrome.
   Attach with `dev-browser --connect http://localhost:9222` (Chrome runs
   with `--remote-debugging-port=9222`). The ZCode in-app browser does
   NOT share Chrome's login and its webview is flaky — don't use it for
   Cloudflare.
2. Click the **Ask AI** button in the navbar, type the request into the
   input whose placeholder is `Type @ to tag a resource or ? for
   shortcuts`, press Enter.
3. The AI performs the action (create/delete DNS records, etc.) and shows
   a **confirmation dialog** — click its confirm button (e.g. `Delete`).
   For writes it may first ask **permission** ("Allow for this
   conversation" / "Just this time") — click one, then **wait 1–2
   minutes**: the AI keeps working after the permission click and
   finishes async. Do not re-submit or fall back to the dashboard just
   because nothing happened after a few seconds — check the conversation
   panel for new tool steps, and only retry after a real failure.
4. Verify with public DNS (`dig +short <hostname>`) or the records table
   — the table may show stale state; DNS is authoritative.

Ask AI worked for: deleting a DNS record (it located the record by name,
prepared the delete, and asked for confirmation).

## Account context (as of 2026-08)

- Account id `1e83e8ee4d1b6e51c2f4527ea005804d`, zones: `4ditor.com`,
  `anywaye.com`, `cafaye.com`, `kakaruto.com`, `kawibot.com`,
  `myrrlabs.com`.
- Rails credentials: `cloudflare: :api_token` — **can list zones but NOT
  edit DNS** (scoped to email sending; DNS writes return "Authentication
  error"). `cloudflare: :tunnel_token` runs the anywaye tunnel.
  `cloudflare: :account_id` is used by `lib/cloudflare_email_delivery.rb`.
- When DNS changes are needed and the dashboard is required, drive the
  DNS records page with **text locators** (`page.locator("text=Add
  record")`), which work where role locators fail; scope row actions with
  `[role=row]` hasText + the Edit button.

## Tunnels (locally managed)

- `anywaye` (id `6970f88d-a5fe-4111-90e5-52b90feee8a5`) and `cafaye-dev`
  both exist; `anywaye` is the voice-line tunnel.
- Ingress lives in `~/.cloudflared/config.yml` (dev.anywaye.com and
  dev.myrrlabs.com → `http://localhost:3000`, catch-all 404). The
  dashboard shows "locally managed — cannot be modified from the
  dashboard" for it. Edit the config file, then restart `bin/dev`
  (Procfile.dev runs the tunnel from the token).
- Do NOT use `cloudflared tunnel route dns <tunnel> <hostname>` to create
  DNS records: `cert.pem` is bound to the cafaye.com zone, so it creates
  the record as `<hostname>.cafaye.com` (a stray). Clean strays by name
  via Ask AI.

## Gotchas (verified live)

- **Free-tier certs**: Universal SSL covers the apex and ONE wildcard
  level only. `voice.dev.myrrlabs.com` (3 levels) failed the TLS
  handshake; the voice line uses 2-level `dev.myrrlabs.com` instead.
- **myrr-gateway Worker**: intercepts `*.myrrlabs.com` root paths and
  returns `Unknown project` (404) for unrecognized hostnames. It is
  path-scoped, so subpaths like `/webhooks/voice/vapi` and `/voice/ws`
  pass through to the tunnel.
- DNS propagation lags after edits (`dig` may still resolve a deleted
  record for a while) — wait or re-check before concluding a change
  failed.
