---
name: 37s
description: Rails application coding patterns derived from analysis of 37signals' full-stack codebases (Fizzy, Once-Campfire, Writebook). Use when building Rails applications (not gems/libraries) in 37signals/Basecamp style. Covers controllers, models, views, Hotwire, testing, database, security, and team philosophy.
---

# 37s Style Guide

Patterns derived from analysis of 37signals' full-stack Rails applications: Fizzy, Once-Campfire, and Writebook. Representative, not authoritative — these reflect observed conventions, not an official 37signals document.

> **Note**: This skill is for Rails applications. For gem/library development patterns, see the `37s-gems` skill.

## Local Codebases

All three codebases are available locally for reference:

- **Fizzy**: `~/Code/37s/fizzy/` — Kanban-style project management
- **Once-Campfire**: `~/Code/37s/once-campfire/` — Web-based chat application
- **Writebook**: `~/Code/37s/writebook/` — Publishing platform

Use these as concrete examples when implementing patterns. Agents can read the code directly for inspiration.

## Topic Map

### Core Rails Patterns
- `references/controllers.md` — Thin controllers, concerns, authentication, authorization
- `references/models.md` — Fat models, scopes, query objects, concerns
- `references/views.md` — Presenters, partials, view helpers, template conventions
- `references/routing.md` — RESTful design, nested resources, custom routes
- `references/database.md` — Schema design, indexes, migrations, query optimization

### Frontend & Hotwire
- `references/hotwire.md` — Turbo Drive, Turbo Frames, Turbo Streams patterns
- `references/stimulus.md` — Stimulus controller conventions, value API, targets
- `references/css.md` — CSS organization, naming conventions, component patterns
- `references/action-text.md` — Rich text integration patterns
- `references/actioncable.md` — WebSocket channel patterns

### Application Features
- `references/authentication.md` — Session management, password reset, remember me
- `references/background-jobs.md` — Solid Queue/ActiveJob patterns, retry strategies
- `references/caching.md` — Fragment caching, counter caches, cache keys
- `references/email.md` — Mailer conventions, transactional email patterns
- `references/notifications.md` — In-app notifications, notification objects
- `references/filtering.md` — Search and filter patterns, query objects
- `references/workflows.md` — Multi-step processes, state machines
- `references/webhooks.md` — Inbound/outbound webhook handling

### Infrastructure
- `references/active-storage.md` — File upload conventions, image variants
- `references/configuration.md` — Environment config, credentials, feature flags
- `references/observability.md` — Logging, error tracking, instrumentation
- `references/performance.md` — N+1 prevention, caching strategies, query optimization
- `references/security-checklist.md` — OWASP checklist, Brakeman, safe patterns
- `references/multi-tenancy.md` — Account scoping, current attributes
- `references/mobile.md` — Mobile-specific patterns, PWA considerations
- `references/ai-llm.md` — LLM/AI integration patterns

### Testing
- `references/testing.md` — 37signals testing approach, fixtures, minitest conventions

### Philosophy & Team
- `references/development-philosophy.md` — Basecamp Way, calm technology, YAGNI
- `references/what-they-avoid.md` — Patterns 37signals deliberately avoids
- `references/dhh.md` — DHH's Rails principles and design opinions
- `references/jorge-manrubia.md` — Jorge Manrubia's contributions and patterns
- `references/jason-zimdars.md` — Jason Zimdars' design and UX conventions
- `references/accessibility.md` — Accessibility patterns and ARIA usage
- `references/watching.md` — Activity feeds, event tracking patterns
- `references/rails-engineering-standards-and-practices.md` — Engineering standards

### Codebase-Specific Patterns
- `references/fizzy-patterns.md` — Fizzy-specific patterns (delegated types, multi-tenancy, search)
- `references/once-campfire-patterns.md` — Once-Campfire patterns (real-time, channels, rooms)
- `references/writebook-patterns.md` — Writebook patterns (content management, editing, publishing)
