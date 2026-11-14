---
name: gemchain
description: Use whenever releasing, bumping, or cascading any ask-* gem (or any gem in the ask-rb monorepo), checking who depends on a gem before release, verifying dependents still pass after a release, or auditing the ecosystem for orphaned releases (published but uncommitted). The golden rule: ALL releases go through gemchain — never `rake release`/`gem push` by hand, never release from a dirty tree, never leave a release uncommitted.
---

# Gemchain — ask-rb Release Coordination

## What it is

`gemchain` is the release tool for the ask-rb gem ecosystem (workspace:
`/Users/kaka/Code/ask-rb`, config `cascade.yml` at the root). It discovers
all `ask-*` gems, builds the dependency graph from their gemspecs, guards
releases, and executes the full cascade: bump → test → release source →
update dependents' constraints → test → release dependents, in topological
order. Installed as a gem (published on RubyGems) — invoke `gemchain` from
the workspace root (config `cascade.yml` is resolved relative to cwd):

```bash
cd /Users/kaka/Code/ask-rb && gemchain <command>
```

The source lives at `~/Code/ask-rb/gemchain`. If the installed binary lags
behind the source (released fixes not yet installed), reinstall with
`gem install gemchain` (or `gem install --local` a fresh build).

## The golden rules (why this skill exists)

1. **Every release goes through `gemchain update`** — never bump the version,
   `gem build`, and `gem push` by hand. Hand releases are how orphaned
   releases happen (published gem whose source was never committed — exactly
   what happened to ask-graph 0.7.2).
2. **Never release from a dirty tree.** `git status` must be clean before a
   release; the executor commits the release's own changes (version,
   gemspec constraint, lockfile) as part of the release step.
3. **A release is only done when the gem is published AND its commit is
   pushed.** After any release, verify the repo's version.rb matches both
   the published RubyGems version and git HEAD.

## Commands

| Command | What it does |
|---|---|
| `gemchain check` | Show every gem, version, dependencies, and dependent counts |
| `gemchain guard <gem>` | Pre-release: list direct + transitive dependents that must still pass |
| `gemchain update <gem> <ver> --dry-run` | Show the exact step plan, change nothing |
| `gemchain update <gem> <ver> --test-only` | Run dependents' suites (`bundle install` + `bundle update <gem>` + `rake test`), edit/release nothing |
| `gemchain update <gem> <ver>` | Execute: source bump→test→release (if the version differs **or the target isn't yet published on RubyGems**), then per dependent: constraint rewrite → test → version bump → commit → `gem build`/`gem push` → tag → push. Prompts [y/N] per release unless `--yes` |
| `gemchain update <gem> <ver> --yes` | Unattended execution (CI/agent use) |
| `gemchain link` | Print a Gemfile block with `path:` refs for local dev |

## The release workflow (always follow this order)

1. **`git status` clean** in the gem's repo. If dirty, commit or stash first.
2. **`gemchain guard <gem>`** — read who depends on it; those gems are the
   blast radius.
3. **Decide the mode:**
   - Source version already published at target (`version.rb == target` and
     on RubyGems): post-release mode — the plan covers dependents only.
   - Source not yet at target: full mode — gemchain bumps, tests, and
     releases the source first (dependents resolve it from RubyGems).
   - `version.rb == target` but NOT on RubyGems (a failed run left it
     bumped but unpublished): still full mode — `update` verifies the
     published version on RubyGems (0.2.1+) before assuming post-release
     mode.
4. **`gemchain update <gem> <ver> --dry-run`** — review the plan.
5. **`gemchain update <gem> <ver> --test-only`** — verify dependents pass
   before touching anything. (Note: this runs `bundle install` in each
   dependent, which may modify its `Gemfile.lock` — commit that sync.)
6. **`gemchain update <gem> <ver>`** — execute. If a dependent fails (tests,
   build, push, etc.), its remaining steps are skipped but the cascade
   **continues** to the next gem. Healthy dependents are still updated and
   released. The final report lists which gems failed and which succeeded.
7. **Verify:** the gem's version on RubyGems, its repo commit pushed, and
   `gemchain check` consistent.

## Orphaned-release audit

After any release, or when asked "are the gems in sync?", audit that
published == local == committed for every gem:

```bash
cd /Users/kaka/Code/ask-rb && ruby -e '
require "json"; require "net/http"
Dir["ask-*/"].each do |dir|
  dir = dir.chomp("/")
  next unless Dir.glob(File.join(dir, "*.gemspec")).any?
  vfile = Dir.glob(File.join(dir, "lib", "**", "version.rb")).find { |f| File.read(f).match?(/VERSION\s*=\s*["'"'"']/) }
  next unless vfile
  local = File.read(vfile)[/VERSION\s*=\s*["'"'"']([^"'"'"']+)["'"'"']/, 1]
  rel = vfile.delete_prefix(dir + "/")
  head = `git -C #{dir} show HEAD:#{rel}`[/VERSION\s*=\s*["'"'"']([^"'"'"']+)["'"'"']/, 1]
  pub = JSON.parse(Net::HTTP.get(URI("https://rubygems.org/api/v1/gems/#{dir}.json")))["version"] rescue nil
  dirty = !`git -C #{dir} status --porcelain`.empty?
  puts "#{dir}: ORPHANED (pub=#{pub} local=#{local} head=#{head})" if pub == local && local != head
  puts "#{dir}: dirty tree" if dirty
end'
```

Any `ORPHANED` line means a release was published without a commit — fix it
by committing the version/changelog changes and pushing (run that gem's
test suite first).

## Config reference (`cascade.yml`)

```yaml
workspace: .          # base dir for relative paths
include: ask-*        # glob(s) for gem dirs
exclude: []           # glob(s) to skip
gems: {}              # explicit name → path overrides
bump: patch           # dependent release bump: patch | minor | major
```

## Executor mechanics (what `update` actually does)

- `:bump` — rewrites `VERSION = "x.y.z"` in `lib/**/version.rb`, preserving
  quote style; idempotent when the version matches.
- `:update_dependency` — rewrites the gemspec line
  (`add_dependency`/`add_runtime_dependency`, both quote styles; adds a
  constraint when missing).
- `:test` — `bundle install` → `bundle update <gem>` → `bundle exec rake
  test` in the gem's dir.
- `:release` — dependent gets a `bump:`-level version bump, then: `git add`
  (gemspec, version.rb, and Gemfile.lock **unless gitignored** — gem repos
  commonly ignore it) → `git commit -m "Cascade: <dep>
  <constraint> (gemchain)"` → `gem build` → `gem push` → `git tag vX.Y.Z`
  → `git push origin HEAD --tags`.

## Known quirks

- Environment: the workspace uses **mise**-managed Ruby — bundles installed
  under the old asdf setup are gone; run `bundle install` in a repo before
  its tests will run.
- The graph only tracks workspace gems; external deps (rails, faraday, …)
  are invisible to `guard`/`check`.
- A few gems are special: ask-rails has no `bundler/gem_tasks` and
  ask-github overrides `release` — irrelevant to gemchain (it runs explicit
  `gem build`/`gem push`, never `rake release`).
- After `--test-only`, a dependent's `Gemfile.lock` may be modified — that
  sync is legit, commit it.
- gemchain itself is not an `ask-*` gem, so the cascade can't release it.
  Releasing gemchain follows the same discipline manually: bump `VERSION`,
  update CHANGELOG, run tests, commit, `gem build` + `gem push`, `git tag`,
  push — then `gem install gemchain` to refresh the binary.
