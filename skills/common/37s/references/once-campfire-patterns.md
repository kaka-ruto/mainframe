# Once-Campfire-Specific Patterns

Patterns observed in the Once-Campfire codebase (`~/Code/37s/once-campfire/`).

## Real-Time Communication Patterns

Once-Campfire is a real-time chat application with extensive use of ActionCable.

### Channel Organization

```ruby
# From app/channels/
- room_channel.rb
- room_messages_channel.rb
- typing_notifications_channel.rb
- read_rooms_channel.rb
- unread_rooms_channel.rb
```

**Key pattern**: Channels are focused on specific real-time concerns.

Source: [Once-Campfire app/channels/](https://github.com/basecamp/once-campfire/tree/main/app/channels)

## Message Patterns

Messages are the core domain entity with rich functionality.

```ruby
class Message < ApplicationRecord
  include Attachment, Broadcasts, Mentionee, Pagination, Searchable

  belongs_to :room, touch: true
  belongs_to :creator, class_name: "User", default: -> { Current.user }

  has_many :boosts, dependent: :destroy

  has_rich_text :body

  before_create -> { self.client_message_id ||= Random.uuid }
  after_create_commit -> { room.receive(self) }
end
```

**Key patterns**:
- `touch: true` on associations for cache invalidation
- `Current.user` for default creator assignment
- `after_create_commit` for broadcasting

Source: [Once-Campfire app/models/message.rb](https://github.com/basecamp/once-campfire/blob/main/app/models/message.rb)

## Room Scoping

Rooms are the primary organizational unit with access controls.

```ruby
# From app/controllers/concerns/room_scoped.rb
module RoomScoped
  extend ActiveSupport::Concern

  private
    def set_room
      @room = Current.user.rooms.find(params[:room_id])
    end
end
```

**Key pattern**: Use concerns to extract common controller logic.

Source: [Once-Campfire app/controllers/concerns/](https://github.com/basecamp/once-campfire/tree/main/app/controllers/concerns)

## CurrentAttributes Pattern

Once-Campfire uses CurrentAttributes for request-level state.

```ruby
class Current < ActiveSupport::CurrentAttributes
  attribute :session, :user, :request

  delegate :host, :protocol, to: :request, prefix: true, allow_nil: true

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

**Key patterns**:
- Automatic user assignment from session
- Request delegation for host/protocol
- Single-account assumption for self-hosted

Source: [Once-Campfire app/models/current.rb](https://github.com/basecamp/once-campfire/blob/main/app/models/current.rb)

## Authentication Patterns

Authentication is implemented as a concern with clear separation.

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

**Key patterns**:
- `allow_unauthenticated_access` for public endpoints
- `require_unauthenticated_access` for login/signup pages
- Bot key bypass for API authentication

Source: [Once-Campfire app/controllers/concerns/authentication.rb](https://github.com/basecamp/once-campfire/blob/main/app/controllers/concerns/authentication.rb)

## Push Notifications

Once-Campfire implements web push notifications.

```ruby
# From app/models/push.rb
class Push < ApplicationRecord
  belongs_to :user

  # Web Push protocol implementation
end
```

**Key pattern**: Push notifications are first-class entities, not just delivery mechanisms.

Source: [Once-Campfire app/models/push.rb](https://github.com/basecamp/once-campfire/blob/main/app/models/push.rb)

## Search Implementation

Full-text search is implemented at the database level.

```ruby
class Search < ApplicationRecord
  # Database-native search, not Elasticsearch
end
```

**Key insight**: Use database-native search when possible, avoid external dependencies.

Source: [Once-Campfire app/models/search.rb](https://github.com/basecamp/once-campfire/blob/main/app/models/search.rb)

## Ban System

Content moderation is implemented through a ban system.

```ruby
class Ban < ApplicationRecord
  belongs_to :user
  # Ban logic for content moderation
end
```

**Key pattern**: Moderation is a core feature, not an afterthought.

Source: [Once-Campfire app/models/ban.rb](https://github.com/basecamp/once-campfire/blob/main/app/models/ban.rb)
