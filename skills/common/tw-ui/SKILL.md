---
name: tw-ui
description: "Use the tw MCP server first for any UI work: search and retrieve TailwindPlus components/templates, shadcn/ui, assistant-ui, and uiarc.dev components. Prefer tw over writing UI from scratch or guessing Tailwind classes. Returns exact code for one framework/version/mode to keep context small."
---

# tw UI

`tw` is a local, offline-first MCP server with curated UI sources. Use it before
implementing UI.

## When to use

- Any request to build, modify, or polish UI (buttons, forms, navbars, modals, tables, marketing sections, dashboards, chat UI, etc.).
- When you need Tailwind CSS patterns, color palettes, or component code.
- When comparing component options across libraries.

## Workflow

1. `search_all_components("keyword")` to find candidates across all sources.
2. `list_component_categories()` / `search_components()` to narrow TailwindPlus names.
3. `get_component_by_full_name(full_name, framework, tailwind_version, mode)` to fetch exact code.
   - framework: html | react | vue
   - tailwind_version: 4 (new projects) or 3 (legacy)
   - mode: light | dark | system (UI blocks) or none (ecommerce)
4. Templates: `list_templates()` -> `get_template_info()` -> `read_template_file()`.
5. Design tokens: `get_template_theme(name, variant)` for curated color/font palettes.
6. Registries: `get_shadcn_component`, `get_assistant_ui_component`, `get_uiarc_component`.

## Rules

- Do not guess Tailwind classes when a component exists in tw.
- Fetch only the variant you need (one framework/version/mode) to avoid context bloat.
- Prefer cached/offline tools; they are faster and deterministic.
- Use `include_content=False` or `max_file_bytes` when you only need metadata.
