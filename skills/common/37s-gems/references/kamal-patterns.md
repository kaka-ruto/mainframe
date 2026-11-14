# Kamal-Specific Patterns

Patterns observed in the Kamal codebase (`~/Code/37s/kamal/`).

## Architecture Overview

Kamal is a deployment tool for Docker-based applications. It's a CLI tool that orchestrates SSH commands to remote servers.

### Core Components

```ruby
# From lib/kamal.rb
module Kamal
  class ConfigurationError < StandardError; end
end

require "zeitwerk"

loader = Zeitwerk::Loader.for_gem
loader.ignore(File.join(__dir__, "kamal", "sshkit_with_ext.rb"))
loader.setup
loader.eager_load_namespace(Kamal::Cli) # Load all commands eagerly
```

**Key patterns**:
- Custom error classes for domain-specific errors
- Zeitwerk for autoloading
- Eager loading for CLI commands

Source: [Kamal lib/kamal.rb](https://github.com/basecamp/kamal/blob/main/lib/kamal.rb)

## CLI Structure

Kamal uses Thor for CLI interface:

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
- Thin CLI commands that delegate to other classes
- Clear command descriptions
- Modular command organization

Source: [Kamal lib/kamal/cli.rb](https://github.com/basecamp/kamal/blob/main/lib/kamal/cli.rb)

## Configuration Management

Kamal handles configuration through YAML files and environment variables:

```ruby
# From lib/kamal/configuration.rb
module Kamal
  class Configuration
    def initialize(config_file)
      @config = YAML.load_file(config_file)
    end
  end
end
```

**Key patterns**:
- YAML for configuration files
- Environment variable interpolation
- Validation of configuration values

Source: [Kamal lib/kamal/configuration.rb](https://github.com/basecamp/kamal/blob/main/lib/kamal/configuration.rb)

## SSH Command Execution

Kamal uses SSHKit for remote command execution:

```ruby
# From lib/kamal/commands.rb
module Kamal
  class Commands
    def execute(command)
      SSHKit.config.command_map[:kamal] = "bundle exec kamal"
      # Execute command on remote server
    end
  end
end
```

**Key patterns**:
- SSHKit for SSH abstraction
- Command mapping for local vs remote
- Error handling for failed commands

Source: [Kamal lib/kamal/commands.rb](https://github.com/basecamp/kamal/blob/main/lib/kamal/commands.rb)

## Testing Patterns

Kamal uses Minitest with fixtures:

```ruby
# From test/test_helper.rb
require "minitest/autorun"
require "kamal"

class KamalTest < Minitest::Test
  def setup
    @kamal = Kamal.new
  end
end
```

**Key patterns**:
- Minitest for testing
- Fixtures for test data
- Mocking with Mocha

Source: [Kamal test/](https://github.com/basecamp/kamal/tree/main/test)

## Dependency Management

Kamal has minimal dependencies:

```ruby
# From kamal.gemspec
spec.add_dependency "activesupport", ">= 7.0"
spec.add_dependency "sshkit", ">= 1.23.0", "< 2.0"
spec.add_dependency "net-ssh", "~> 7.3"
spec.add_dependency "thor", "~> 1.3"
spec.add_dependency "dotenv", "~> 3.1"
```

**Key patterns**:
- Minimal runtime dependencies
- Pinned versions for stability
- Separate development dependencies

Source: [Kamal gemspec](https://github.com/basecamp/kamal/blob/main/kamal.gemspec)

## Error Handling

Kamal uses custom error classes:

```ruby
module Kamal
  class ConfigurationError < StandardError; end
  class CommandError < StandardError; end
end
```

**Key patterns**:
- Domain-specific error classes
- Clear error messages
- Error recovery strategies

Source: [Kamal lib/kamal.rb](https://github.com/basecamp/kamal/blob/main/lib/kamal.rb)

## Versioning

Kamal follows semantic versioning:

```ruby
# From lib/kamal/version.rb
module Kamal
  VERSION = "2.5.0"
end
```

**Key patterns**:
- Semantic versioning (MAJOR.MINOR.PATCH)
- Version constant in dedicated file
- Version referenced in gemspec

Source: [Kamal lib/kamal/version.rb](https://github.com/basecamp/kamal/blob/main/lib/kamal/version.rb)
