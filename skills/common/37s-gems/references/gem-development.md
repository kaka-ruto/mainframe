# General Gem Development Patterns

General patterns for developing Ruby gems, derived from 37signals' practices.

## Gem Structure

### Standard Layout

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

### Engine Layout (for Rails integration)

```
gem-name/
├── app/
│   ├── assets/
│   ├── controllers/
│   ├── helpers/
│   ├── javascript/
│   ├── views/
│   └── ...
├── config/
│   └── routes.rb
├── db/
│   └── migrate/
├── lib/
│   ├── gem_name/
│   │   ├── engine.rb
│   │   └── ...
│   └── gem_name.rb
└── ...
```

## Gemspec Best Practices

### File Inclusion

```ruby
spec.files = Dir["lib/**/*", "MIT-LICENSE", "README.md"]
```

**Key patterns**:
- Use `Dir[]` for file inclusion
- Include license and README
- Exclude test files and development artifacts

### Dependencies

```ruby
# Runtime dependencies
spec.add_dependency "activesupport", ">= 7.0"
spec.add_dependency "thor", "~> 1.3"

# Development dependencies
spec.add_development_dependency "debug"
spec.add_development_dependency "minitest", "< 6"
```

**Key patterns**:
- Pin versions appropriately
- Separate runtime and development dependencies
- Use pessimistic version constraints (`~>`)

### Executables

```ruby
spec.executables = %w[ gem-name ]
```

**Key patterns**:
- Define executable binaries
- Keep executables thin
- Delegate to CLI class

## Autoloading with Zeitwerk

### Gem Autoloading

```ruby
# From lib/gem_name.rb
require "zeitwerk"

loader = Zeitwerk::Loader.for_gem
loader.setup
```

### Engine Autoloading

```ruby
# From lib/gem_name/engine.rb
module GemName
  class Engine < ::Rails::Engine
    isolate_namespace GemName
  end
end
```

**Key patterns**:
- Use `Loader.for_gem` for gems
- Use `isolate_namespace` for engines
- Handle special files with `ignore`

## Testing Patterns

### Minitest Setup

```ruby
# From test/test_helper.rb
require "minitest/autorun"
require "gem_name"

class GemNameTest < Minitest::Test
  def setup
    @gem = GemName.new
  end
end
```

### Fixtures

```ruby
# From test/fixtures.yml
user:
  name: "Test User"
  email: "test@example.com"
```

### System Tests

```ruby
# From test/system/feature_test.rb
class FeatureTest < ActionDispatch::SystemTestCase
  driven_by :cuprite

  test "feature works" do
    # Implementation
  end
end
```

## CLI Patterns

### Thor Structure

```ruby
# From lib/gem_name/cli.rb
require "thor"

module GemName
  class CLI < Thor
    desc "command", "Description of command"
    def command
      # Implementation
    end
  end
end
```

**Key patterns**:
- Use Thor for CLI structure
- Define commands with descriptions
- Keep commands thin

### Command Organization

```ruby
module GemName
  class CLI < Thor
    desc "subcommand SUBCOMMAND", "Subcommands"
    subcommand "subcommand", GemName::CLI::Subcommand
  end
end
```

## Version Management

### Semantic Versioning

```ruby
# From lib/gem_name/version.rb
module GemName
  VERSION = "1.2.3"
end
```

**Key patterns**:
- Follow semantic versioning
- MAJOR: Breaking changes
- MINOR: New features
- PATCH: Bug fixes

### Version Bumping

1. Update version in `lib/gem_name/version.rb`
2. Update CHANGELOG.md
3. Create git tag: `git tag v1.2.3`
4. Push to RubyGems: `gem push gem-name-1.2.3.gem`

## Documentation Patterns

### README Structure

```markdown
# Gem Name

Brief description of what the gem does.

## Installation

```ruby
gem install gem-name
```

Or in Gemfile:

```ruby
gem "gem-name"
```

## Usage

Basic usage examples.

## Contributing

How to contribute.

## License

MIT License.
```

### YARD Documentation

```ruby
# Documentation comment
#
# @param name [String] The name
# @return [Boolean] Whether successful
def method(name)
  # Implementation
end
```

## Performance Patterns

### Lazy Loading

```ruby
def self.heavy_feature
  require "heavy_gem"
  HeavyGem.new
end
```

### Caching

```ruby
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

## Release Patterns

### CI/CD with GitHub Actions

```yaml
# From .github/workflows/release.yml
name: Release
on:
  push:
    tags:
      - 'v*'
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: ruby/setup-ruby@v1
        with:
          ruby-version: '3.2'
      - run: gem build gem-name.gemspec
      - run: gem push gem-name-*.gem
```

### Changelog

```markdown
# Changelog

## 1.2.3 (2024-01-01)

### Features
- New feature A
- New feature B

### Bug Fixes
- Fix bug C
- Fix bug D
```

## References

- [Zeitwerk](https://github.com/fxn/zeitwerk) — Autoloader
- [Thor](https://github.com/erikhuda/thor) — CLI framework
- [Minitest](https://github.com/seattlerb/minitest) — Testing framework
- [RubyGems](https://rubygems.org) — Gem hosting
- [Bundler](https://bundler.io) — Dependency management
