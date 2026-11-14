---
name: 37s-gems
description: Gem development patterns from 37signals' open source gems (Kamal, Lexxy). Use when building Ruby gems, Rails engines, or libraries. Covers gem structure, engine patterns, testing, versioning, and release patterns.
version: 1.0.0
user-invocable: true
argument-hint: "[pattern-name]"
---

# 37s Gem Development Patterns

Patterns derived from analysis of 37signals' open source gems: Kamal and Lexxy. These are battle-tested patterns for building high-quality Ruby gems and Rails engines.

## Local Codebases

All gem codebases are available locally for reference:

- **Kamal**: `~/Code/37s/kamal/` — Deployment tool for Docker-based apps
- **Lexxy**: `~/Code/37s/lexxy/` — Rich text editor for Action Text

Use these as concrete examples when implementing gem patterns. Agents can read the code directly for inspiration.

## Gem Structure Patterns

### Standard Gem Layout

```
gem-name/
├── lib/
│   ├── gem_name.rb          # Main entry point
│   ├── gem_name/
│   │   ├── version.rb       # Version constant
│   │   └── ...              # Other modules
│   └── ...
├── test/ or spec/           # Tests
├── gem-name.gemspec         # Gem specification
├── Gemfile                  # Dependencies
├── README.md                # Documentation
├── LICENSE.md               # License
└── .gitignore               # Git ignore
```

Source: [Kamal](https://github.com/basecamp/kamal), [Lexxy](https://github.com/basecamp/lexxy)

### Gemspec Best Practices

```ruby
# From kamal.gemspec
Gem::Specification.new do |spec|
  spec.name        = "kamal"
  spec.version     = Kamal::VERSION
  spec.authors     = [ "David Heinemeier Hansson" ]
  spec.email       = "dhh@hey.com"
  spec.homepage    = "https://github.com/basecamp/kamal"
  spec.summary     = "Deploy web apps in containers to servers running Docker with zero downtime."
  spec.license     = "MIT"
  spec.files = Dir["lib/**/*", "MIT-LICENSE", "README.md"]
  spec.executables = %w[ kamal ]

  spec.add_dependency "activesupport", ">= 7.0"
  spec.add_dependency "sshkit", ">= 1.23.0", "< 2.0"
  # ... more dependencies
end
```

**Key patterns**:
- Use `Dir["lib/**/*"]` for files
- Specify executable binaries
- Pin dependency versions appropriately
- Separate runtime and development dependencies

Source: [Kamal gemspec](https://github.com/basecamp/kamal/blob/main/kamal.gemspec)

## Zeitwerk Autoloading

Use Zeitwerk for autoloading in gems:

```ruby
# From lib/kamal.rb
require "zeitwerk"

loader = Zeitwerk::Loader.for_gem
loader.ignore(File.join(__dir__, "kamal", "sshkit_with_ext.rb"))
loader.setup
loader.eager_load_namespace(Kamal::Cli) # Load all commands eagerly
```

**Key patterns**:
- Use `Loader.for_gem` for gem autoloading
- Ignore files that don't follow naming conventions
- Eager load namespaces when needed

Source: [Kamal lib/kamal.rb](https://github.com/basecamp/kamal/blob/main/lib/kamal.rb)

## Rails Engine Patterns

For gems that integrate with Rails, use the engine pattern:

```ruby
# From lib/lexxy/engine.rb
module Lexxy
  class Engine < ::Rails::Engine
    isolate_namespace Lexxy
    
    # Initialize engine
    initializer "lexxy" do |app|
      # Configuration
    end
  end
end
```

**Key patterns**:
- `isolate_namespace` to avoid conflicts
- Initializers for configuration
- Asset pipeline integration

Source: [Lexxy lib/lexxy/engine.rb](https://github.com/basecamp/lexxy/blob/main/lib/lexxy/engine.rb)

## Version Management

Use a version constant in a dedicated file:

```ruby
# From lib/kamal/version.rb
module Kamal
  VERSION = "2.5.0"
end
```

**Key patterns**:
- Keep version in a dedicated file
- Use semantic versioning
- Reference version in gemspec

Source: [Kamal lib/kamal/version.rb](https://github.com/basecamp/kamal/blob/main/lib/kamal/version.rb)

## Testing Patterns

### Minitest for Gems

```ruby
# From Kamal test structure
test/
├── test_helper.rb
├── commands/
│   ├── app_test.rb
│   └── ...
└── ...
```

**Key patterns**:
- Use Minitest (not RSpec) for consistency
- Mirror lib structure in test directory
- Use fixtures for complex test data

Source: [Kamal test/](https://github.com/basecamp/kamal/tree/main/test)

### System Tests for UI Gems

```ruby
# From Lexxy test structure
test/
├── system/
│   ├── code_highlighting_test.rb
│   └── upload_focus_test.rb
├── browser/
│   └── tests/
│       ├── attachments/
│       ├── editor/
│       └── ...
└── ...
```

**Key patterns**:
- System tests for UI components
- Browser tests with Playwright
- Organize by feature area

Source: [Lexxy test/](https://github.com/basecamp/lexxy/tree/main/test)

## CLI Patterns

For gems with CLI interfaces, use Thor:

```ruby
# From lib/kamal/cli.rb
require "thor"

module Kamal
  class CLI < Thor
    desc "setup", "Setup Kamal"
    def setup
      # Implementation
    end
  end
end
```

**Key patterns**:
- Use Thor for CLI structure
- Define commands with descriptions
- Keep commands thin, delegate to other classes

Source: [Kamal lib/kamal/cli.rb](https://github.com/basecamp/kamal/blob/main/lib/kamal/cli.rb)

## Dependency Management

### Gemfile for Development

```ruby
# From Kamal Gemfile
source "https://rubygems.org"

gemspec

group :development do
  gem "debug"
  gem "minitest", "< 6"
  gem "mocha"
end
```

**Key patterns**:
- Use `gemspec` to pull dependencies from gemspec
- Group development dependencies
- Pin versions for stability

Source: [Kamal Gemfile](https://github.com/basecamp/kamal/blob/main/Gemfile)

## Documentation Patterns

### README Structure

```markdown
# Gem Name

Brief description of what the gem does.

## Installation

How to install the gem.

## Usage

Basic usage examples.

## Contributing

How to contribute.

## License

MIT License.
```

**Key patterns**:
- Clear, concise description
- Installation instructions
- Usage examples
- Contributing guidelines

Source: [Kamal README.md](https://github.com/basecamp/kamal/blob/main/README.md)

## Release Patterns

### Version Bumping

1. Update version in `lib/gem_name/version.rb`
2. Update CHANGELOG.md
3. Create git tag
4. Push to RubyGems

### CI/CD

Use GitHub Actions for:
- Running tests on multiple Ruby versions
- Automated gem publishing
- Security scanning

Source: [Kamal .github/](https://github.com/basecamp/kamal/tree/main/.github)

## Performance Patterns

### Lazy Loading

```ruby
# Load heavy dependencies only when needed
def self.heavy_feature
  require "heavy_gem"
  HeavyGem.new
end
```

### Caching

```ruby
# Cache expensive computations
def expensive_calculation
  @expensive_calculation ||= begin
    # Complex computation
  end
end
```

## Security Patterns

### Secure Dependencies

- Use `bundle-audit` to check for vulnerabilities
- Pin dependency versions
- Regularly update dependencies

### Secure Coding

- Validate all inputs
- Use `bundled-credentials` for secrets
- Never hardcode secrets

## References

- [Kamal](https://github.com/basecamp/kamal) — Deployment tool
- [Lexxy](https://github.com/basecamp/lexxy) — Rich text editor
- [Zeitwerk](https://github.com/fxn/zeitwerk) — Autoloader
- [Thor](https://github.com/erikhuda/thor) — CLI framework
- [Minitest](https://github.com/seattlerb/minitest) — Testing framework
