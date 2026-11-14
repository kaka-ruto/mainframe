# Lexxy-Specific Patterns

Patterns observed in the Lexxy codebase (`~/Code/37s/lexxy/`).

## Architecture Overview

Lexxy is a rich text editor for Action Text, distributed as both a Ruby gem and an npm package. It's built on Meta's Lexical framework.

### Dual Distribution

```ruby
# From lexxy.gemspec
Gem::Specification.new do |spec|
  spec.name        = "lexxy"
  spec.version     = Lexxy::VERSION
  spec.files = Dir.chdir(File.expand_path(__dir__)) do
    Dir["{app,config,db,lib}/**/*", "MIT-LICENSE", "Rakefile", "README.md"]
  end
  spec.extensions = [ "ext/Rakefile" ]
end
```

**Key patterns**:
- Ruby gem for Rails integration
- npm package for JavaScript
- Shared codebase for both

Source: [Lexxy gemspec](https://github.com/basecamp/lexxy/blob/main/lexxy.gemspec)

## Rails Engine Pattern

Lexxy is implemented as a Rails engine:

```ruby
# From lib/lexxy/engine.rb
module Lexxy
  class Engine < ::Rails::Engine
    isolate_namespace Lexxy
    
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

## Form Helpers

Lexxy provides form helpers for Rails:

```ruby
# From lib/lexxy/form_helper.rb
module Lexxy
  module FormHelper
    def lexxy_text_area(object_name, method, options = {})
      # Implementation
    end
  end
end
```

**Key patterns**:
- Form helpers for easy integration
- Options for customization
- Integration with Action View

Source: [Lexxy lib/lexxy/form_helper.rb](https://github.com/basecamp/lexxy/blob/main/lib/lexxy/form_helper.rb)

## Action Text Integration

Lexxy integrates deeply with Action Text:

```ruby
# From lib/lexxy/action_text_tag.rb
module Lexxy
  module ActionTextTag
    # Custom tags for Action Text
  end
end
```

**Key patterns**:
- Custom tags for rich text
- Attachment handling
- Remote video support

Source: [Lexxy lib/lexxy/action_text_tag.rb](https://github.com/basecamp/lexxy/blob/main/lib/lexxy/action_text_tag.rb)

## Testing Patterns

Lexxy has comprehensive testing:

### System Tests

```ruby
# From test/system/code_highlighting_test.rb
class CodeHighlightingTest < ActionDispatch::SystemTestCase
  driven_by :cuprite

  test "code highlighting" do
    # Implementation
  end
end
```

### Browser Tests with Playwright

```ruby
# From test/browser/tests/
- attachments/
- editor/
- formatting/
- modes/
- paste/
- prompts/
- tables/
```

**Key patterns**:
- System tests for UI components
- Browser tests with Playwright
- Organized by feature area

Source: [Lexxy test/](https://github.com/basecamp/lexxy/tree/main/test)

## JavaScript Integration

Lexxy has a JavaScript component:

```javascript
// From src/
- editor.js
- plugins/
- nodes/
```

**Key patterns**:
- Lexical framework for editor
- Plugin architecture
- Modular JavaScript code

Source: [Lexxy src/](https://github.com/basecamp/lexxy/tree/main/src)

## Style Guidelines

Lexxy has detailed style guidelines:

```markdown
# From STYLE.md
- JavaScript/Lexical patterns
- Ruby conventions
- Test patterns
```

**Key patterns**:
- Consistent coding style
- Clear conventions
- Documentation of patterns

Source: [Lexxy STYLE.md](https://github.com/basecamp/lexxy/blob/main/STYLE.md)

## Performance Patterns

Lexxy includes performance benchmarks:

```bash
# From package.json
yarn benchmark:browser
yarn benchmark:browser:compare
```

**Key patterns**:
- Browser benchmarks for performance
- Comparison tools
- CI integration

Source: [Lexxy package.json](https://github.com/basecamp/lexxy/blob/main/package.json)

## Development Setup

Lexxy has specific development setup:

```bash
# From AGENTS.md
bin/setup
cd test/dummy && bin/rails db:prepare db:seed
bin/dev
```

**Key patterns**:
- Setup scripts for development
- Dummy app for testing
- Clear development instructions

Source: [Lexxy AGENTS.md](https://github.com/basecamp/lexxy/blob/main/AGENTS.md)
