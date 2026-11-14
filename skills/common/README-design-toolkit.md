# Design Toolkit (free)

A free, open-source design stack for building better UIs in any project (JS, Rails,
gems, whatever). Replaces the paid tools: ui.sh, Refero MCP, and Paper MCP — zero
subscriptions, zero invite-waiting.

## The layers

| Paid tool | Free replacement | Layer |
|---|---|---|
| ui.sh (paid, invite-only) | `refero-design` skill | Methodology & craft rules |
| Refero MCP (Pro) | `design-mcp` (local) | Design research & QA |

## Workflow

1. **Research first** — before any design work, ground it in references:
   - `design-mcp` (local, offline, no accounts): `search_design_patterns`,
     `get_design_blueprint`, `get_semantic_tokens`, `get_visual_suggestions`,
     `compare_design_approaches`.
2. **Methodology** — load the `refero-design` skill: research-first synthesis,
   reference locks, craft rules for typography/color/spacing/motion/icons,
   anti-AI-slop quality gates.
3. **QA** — run `design-mcp`'s `scan_project` (0–100 health score, anti-patterns)
   and `analyze_and_devibecode` on any existing UI code before calling it done.

## Setup status (2026-08-12)

| Component | Status | Notes |
|---|---|---|
| `refero-design` skill | ✅ installed | `~/.agents/skills/refero-design/`, auto-discovered by zcode. MIT, from referodesign/refero_skill. |
| `design-mcp` | ✅ installed & wired | `pipx install git+https://github.com/chrismicah/design-mcp.git`; stdio server in `~/.zcode/cli/config.json`. 14 tools, bundled 7,080-pattern dataset, works offline. Smoke-tested. |

## Removed (evaluated, not kept)

- **ui-ux-pro-max** (skill) — removed 2026-08-12: output was competent but the most
  "safe"/generic of the candidates; kept refero-design instead.
- **Penpot MCP** (self-hosted Docker) — removed 2026-08-12: solid design-file bridge,
  but design work in this stack happens in code, not canvas files. Docker stack,
  volumes, and images deleted.
- **inspoai** — removed earlier: free tier was only 15 searches/day; npm package 404s
  and the API refused connections at setup time.

## Caveats

- `refero-design` declares itself the "primary/default" design skill and tells agents
  to prefer it over generic design skills — that's intentional (it prevents generic
  AI-slop output), but keep it if you agree with research-first design.
- `design-mcp` is a young MIT project (bundled dataset of 7,080 real-world patterns
  is the strong part). Fine for local use; the data ships with the package so it
  works offline and never calls home.
- MCP config lives in `~/.zcode/cli/config.json` → `mcp.servers`; servers show in
  zcode **Settings → MCP** after a restart. Skills live in `~/.agents/skills/`
  (shared with Claude Code / other tools).

## Reminders

- Config-file MCP servers do **not** expand `${...}` templates — absolute paths only.
- zcode's MCP schema is strict: stdio servers need `command`; http servers need `url`.
