---
name: rails-credentials
description: Edit Rails encrypted credentials (.yml.enc) without destroying their comments, blank lines, and quoting. Use when a task involves changing secrets in config/credentials/ — READ this before touching any .yml.enc file.
---

# Editing Rails Encrypted Credentials

Rails credentials live encrypted in `config/credentials/<env>.yml.enc` (or `config/credentials.yml.enc`). They cannot be edited directly — you must decrypt, change, and re-encrypt with the same key.

## The one rule that matters

**Never decrypt → modify → re-encrypt through a YAML library.** `YAML.load(...)`, mutate, then `YAML.dump` / `.to_yaml` (or `ruby -ryaml -e '...'`) destroys every comment, blank line, and your quoting style. Psych re-emits the document from the data structure. The result is the machine-dump format: `---` header, `:symbol:` keys, no comments — exactly the corruption you are trying to avoid.

Edits must be **textual**: change only the lines you need, keep everything else byte-identical.

## If the app has `bin/creds` (preferred)

The Rails app may ship a `bin/creds` helper (see below). From the app root:

```bash
bin/creds show [env]                 # print decrypted credentials
bin/creds set [env] key.path=value   # set ONE value, formatting-preserving
bin/creds unset [env] key.path       # remove a key/block (prunes empty parents)
bin/creds import [env] <file>        # re-encrypt a hand-edited plaintext file
bin/creds verify [env]               # decrypt, parse, flag formatting drift
bin/creds ls                         # list environments
bin/creds help                       # show usage
```

`env` defaults to `development`; `base` targets `config/credentials.yml.enc`.

- **One value** → `bin/creds set development deepseek.api_key=sk-...`. It does a line-based edit (never a re-serialize), auto-verifies comments are preserved and the value round-trips, and rolls back if anything looks wrong. Quote the value as a single shell argument if it contains spaces.
- **Remove a key or block** → `bin/creds unset development openrouter.api_key`. Unsetting the last key of a block also removes the (now empty) block and its doc comments; section headers stay. Auto-verifies the removed path is the only difference and rolls back on failure.
- **Several keys / structural changes** → `bin/creds show development > /tmp/creds.yml`, edit `/tmp/creds.yml` as **plain text** (keep the comments, blank lines, section headers, and quoting), then `bin/creds import development /tmp/creds.yml`. `import` warns if the comment lines vanished — that means formatting was stripped and you should fix the file before committing.
- **Always** run `bin/creds verify <env>` after any change and eyeball the decrypted diff.

If `bin/creds` is missing, create it (it's a small, repo-local script) — or use the fallback below.

## Fallback: decrypt/re-encrypt manually with Rails' own classes

Never hand-roll the cipher. Use `ActiveSupport::EncryptedFile` (same code path as `rails credentials:edit`):

```bash
bin/rails runner '
path = Rails.root.join("config/credentials/development.yml.enc")
key_path = Rails.root.join("config/credentials/development.key")
ef = ActiveSupport::EncryptedFile.new(
  content_path: path, key_path: key_path,
  env_key: "RAILS_MASTER_KEY", raise_if_missing_key: true
)
puts ef.read   # decrypt; edit the output as TEXT, then:
# ef.write(File.read("/tmp/edited.yml"))
'
```

Then re-encrypt by replacing the `puts` with an `ef.write(...)` of the textually-edited file. `rails credentials:edit --environment <env>` only works for interactive humans — do not rely on it for agent edits.

## Workflow checklist

1. Decrypt and read the current file (`bin/creds show` or `ef.read`).
2. Edit **only** the intended lines — preserve comments, blank lines, quoting, section headers.
3. Re-encrypt with the same key file (never a different/regenerated key).
4. Verify: decrypt again, confirm the data parses, comment lines are unchanged, and the plaintext diff touches only what you intended.
5. Never commit `.key` files or master keys. Delete plaintext temp copies (e.g. `/tmp/creds.yml`) — they contain secrets.
