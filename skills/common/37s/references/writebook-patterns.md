# Writebook-Specific Patterns

Patterns observed in the Writebook codebase (`~/Code/37s/writebook/`).

## Content Management Patterns

Writebook is a publishing platform with sophisticated content management.

### Delegated Types for Content

```ruby
# From app/models/leaf.rb
class Leaf < ApplicationRecord
  include Editable, Positionable, Searchable

  belongs_to :book, touch: true
  delegated_type :leafable, types: Leafable::TYPES, dependent: :destroy
  positioned_within :book, association: :leaves, filter: :active

  delegate :searchable_content, to: :leafable

  enum :status, %w[ active trashed ].index_by(&:itself), default: :active

  scope :with_leafables, -> { includes(:leafable) }
end
```

**Key patterns**:
- `delegated_type` for polymorphic content
- `positioned_within` for ordering
- `enum :status` for state management

Source: [Writebook app/models/leaf.rb](https://github.com/basecamp/writebook/blob/main/app/models/leaf.rb)

## Leafable Concern

The Leafable concern defines the interface for content types.

```ruby
module Leafable
  extend ActiveSupport::Concern

  TYPES = %w[ Page Section Picture ]

  included do
    has_one :leaf, as: :leafable, inverse_of: :leafable, touch: true
    has_one :book, through: :leaf
    has_one :edit, as: :leafable

    delegate :title, to: :leaf
  end

  def owning_book
    book || edit&.leaf&.book
  end

  def searchable_content
    nil
  end

  class_methods do
    def leafable_name
      @leafable_name ||= ActiveModel::Name.new(self).singular.inquiry
    end
  end

  def leafable_name
    self.class.leafable_name
  end
end
```

**Key patterns**:
- `TYPES` constant for available content types
- `owning_book` method for content ownership
- `leafable_name` for dynamic type checking

Source: [Writebook app/models/leafable.rb](https://github.com/basecamp/writebook/blob/main/app/models/leafable.rb)

## Edit/Revision Pattern

Writebook implements content versioning through edits.

```ruby
# From app/models/edit.rb
class Edit < ApplicationRecord
  delegated_type :leafable, types: Leafable::TYPES, dependent: :destroy
end
```

**Key insight**: Edits are first-class entities that capture revisions.

Source: [Writebook app/models/edit.rb](https://github.com/basecamp/writebook/blob/main/app/models/edit.rb)

## CurrentAttributes Pattern

Writebook uses CurrentAttributes for request-level state.

```ruby
class Current < ActiveSupport::CurrentAttributes
  attribute :session, :user

  def session=(value)
    super(value)

    if value.present?
      self.user = session.user
    end
  end

  def account
    Account.first
  end
end
```

**Key pattern**: Single-account assumption for self-hosted applications.

Source: [Writebook app/models/current.rb](https://github.com/basecamp/writebook/blob/main/app/models/current.rb)

## Controller Inheritance

Writebook uses controller inheritance for content types.

```ruby
class PagesController < LeafablesController
  before_action :forget_reading_progress, except: :show

  private
    def forget_reading_progress
      cookies.delete "reading_progress_#{@book.id}"
    end

    def default_leaf_params
      { title: "Untitled" }
    end

    def new_leafable
      Page.new leafable_params
    end

    def leafable_params
      params.fetch(:page, {}).permit(:body)
    end
end
```

**Key patterns**:
- `LeafablesController` as base class
- `leafable_params` for type-specific parameters
- `new_leafable` for factory method

Source: [Writebook app/controllers/pages_controller.rb](https://github.com/basecamp/writebook/blob/main/app/controllers/pages_controller.rb)

## Testing Conventions

Writebook has specific testing conventions.

### Use Existing Fixtures

```ruby
# Prefer using existing fixtures
leaves(:welcome_page)  # Good
books(:handbook).press Page.new(body: "..."), title: "..."  # Avoid
```

### URL Helpers in Tests

```ruby
# Use _path helpers
get book_slug_path(books(:handbook))

# Avoid _url helpers
get book_slug_url(books(:handbook))
```

### Response Body Assertions

```ruby
# Use assert_in_body
assert_in_body "Expected content"
assert_not_in_body "Unexpected content"

# Avoid assert_includes
assert_includes response.body, "Expected content"
```

Source: [Writebook AGENTS.md](https://github.com/basecamp/writebook/blob/main/AGENTS.md)

## Simplified respond_to Blocks

```ruby
# Preferred
def show
  respond_to do |format|
    format.html
    format.md
  end
end

# Avoid
def show
  respond_to do |format|
    format.html { render }
    format.md { render }
  end
end
```

Source: [Writebook AGENTS.md](https://github.com/basecamp/writebook/blob/main/AGENTS.md)

## Authentication Patterns

Writebook implements authentication as a concern.

```ruby
module Authentication
  extend ActiveSupport::Concern
  include SessionLookup

  included do
    before_action :require_authentication
    helper_method :signed_in?

    protect_from_forgery with: :exception, unless: -> { authenticated_by.bot_key? }
  end

  class_methods do
    def require_unauthenticated_access(**options)
      allow_unauthenticated_access **options
      before_action :redirect_signed_in_user_to_root, **options
    end

    def allow_unauthenticated_access(**options)
      skip_before_action :require_authentication, **options
      before_action :restore_authentication, **options
    end
  end
end
```

**Key pattern**: Same authentication pattern as Once-Campfire, showing consistency across 37signals products.

Source: [Writebook app/controllers/concerns/authentication.rb](https://github.com/basecamp/writebook/blob/main/app/controllers/concerns/authentication.rb)
