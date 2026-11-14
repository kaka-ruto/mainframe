# Fizzy-Specific Patterns

Patterns observed in the Fizzy codebase (`~/Code/37s/fizzy/`).

## Delegated Types for Content Management

Fizzy uses delegated types extensively for modeling heterogeneous content types.

### Recordables Architecture

```ruby
# From app/models/card.rb
class Card < ApplicationRecord
  include Accessible, Assignable, Attachments, Broadcastable, Closeable, Colored, Commentable,
    Entropic, Eventable, Exportable, Golden, Mentions, Multistep, Pinnable, Postponable, Promptable,
    Readable, Searchable, Stallable, Statuses, Storage::Tracked, Taggable, Triageable, Watchable
end
```

**Key insight**: Cards are the core domain entity, with behavior organized into focused concerns.

Source: [Fizzy app/models/card.rb](https://github.com/basecamp/fizzy/blob/main/app/models/card.rb)

## Multi-Tenancy Pattern

Fizzy implements URL-based multi-tenancy with account scoping.

### Account Slug Extraction

```ruby
# Middleware extracts account slug from URL
# PATH_INFO: /{account_id}/boards/...
# SCRIPT_NAME: /{account_id}
```

**Key pattern**: Domain records are account-scoped; identity, session, and authentication records are global exceptions.

Source: [Fizzy AGENTS.md](https://github.com/basecamp/fizzy/blob/main/AGENTS.md)

## Search Implementation

Fizzy uses database-native full-text search, not Elasticsearch.

### MySQL Sharded Search

```ruby
# Search::Record::Sharded
# Shards 16 ways by CRC32 of account ID
```

### SQLite Single-Index Search

```ruby
# Search::Record::SQLite
# Single FTS5 index
```

**Key insight**: Don't assume the sharded shape when working under SQLite.

Source: [Fizzy AGENTS.md](https://github.com/basecamp/fizzy/blob/main/AGENTS.md)

## UUID Primary Keys

All tables use UUIDv7 keys, base36-encoded to 25 characters.

```ruby
# Fixture UUIDs are generated to sort older than any runtime record
# so .first/.last stay deterministic in tests
```

**Key pattern**: Don't "fix" ordering by comparing insertion order to id order.

Source: [Fizzy AGENTS.md](https://github.com/basecamp/fizzy/blob/main/AGENTS.md)

## Data Transfer Patterns

Data transfer between instances must work against both local and S3 storage.

```ruby
# Archives can exceed hundreds of gigabytes
# Stream, never buffer a whole file
```

Source: [Fizzy AGENTS.md](https://github.com/basecamp/fizzy/blob/main/AGENTS.md)

## Concern Organization

Fizzy organizes models into focused concerns, each handling a specific responsibility.

```ruby
class Card < ApplicationRecord
  include Accessible, Assignable, Attachments, Broadcastable, Closeable, Colored, Commentable,
    Entropic, Eventable, Exportable, Golden, Mentions, Multistep, Pinnable, Postponable, Promptable,
    Readable, Searchable, Stallable, Statuses, Storage::Tracked, Taggable, Triageable, Watchable
end
```

**Guidelines**:
- Each concern should be 50-150 lines
- Must be cohesive (related functionality together)
- Don't create concerns just to reduce file size

Source: [37signals-skills](https://github.com/marckohlbrugge/37signals-skills/blob/main/guide/development-philosophy.md)

## Scope Naming

Scopes are named for business concepts, not SQL operations.

```ruby
# Good - business-focused
scope :active, -> { where.missing(:pop) }
scope :unassigned, -> { where.missing(:assignments) }

# Not SQL-ish
scope :without_pop, -> { ... }
scope :no_assignments, -> { ... }
```

Source: [37signals-skills](https://github.com/marckohlbrugge/37signals-skills/blob/main/guide/development-philosophy.md)

## Transaction Wrapping

Wrap related updates for consistency.

```ruby
def toggle_stage(stage)
  transaction do
    update! stage: new_stage
    track_event event, stage_id: stage.id
  end
end
```

**When to use**: Multi-step operations, parent + children records, state transitions.

Source: [37signals-skills](https://github.com/marckohlbrugge/37signals-skills/blob/main/guide/development-philosophy.md)
