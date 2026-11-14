# A trusted helper and a sealed sign-in, worked

Small programs that run, for the pattern in `../guest.md` ("Trusted users",
"Logins"): one small helper is the only user the template trusts. It signs in
to the user's websites for the assistant and never answers a secret.
Everything else, your harness included, runs as the image's `USER`, which
s5x refuses the vault and logins. s5x ships none of this as a library: copy
it and make it yours.

| file | what it shows |
|---|---|
| `trusted-helper/Dockerfile` | an image with two users, `helper` (trusted) and `agent` (`USER`), Chromium, the Chrome policies, and nothing set-user-ID |
| `trusted-helper/start.sh` | the entrypoint, as root: a volume whose root is not root's refused, the directories each user needs, the helper started as `helper` in a restart loop with a log of its own, the harness as `agent`, and no root process left |
| `trusted-helper/helper.ts` | the helper, as `helper`, the only trusted code: `GET /logins` and `POST /sign-in` on a Unix socket only `agent` can reach, and nothing else |
| `trusted-helper/harness.ts` | the harness, as `agent`: `signIn(website, path)` asks the helper and hands the session to the assistant's browser; your agent loop goes in it |
| `sealed-sign-in/sign-in.ts` | the sign-in: a fresh Chrome over `--remote-debugging-pipe` with a throwaway profile, `logins/get`, the form filled in its own document and submitted, `logins/totp` when the site asks for a code, the login's cookies written to a session file, the profile deleted, all within 120 s |
| `sealed-sign-in/chrome-policy.json` | the policies that turn Chrome's password manager, its leak detection and autofill off |

## What runs as whom

| process | runs as | what it does |
|---|---|---|
| `start.sh` | root, until it is done | makes `/data/sessions` (the helper writes, `agent` only reads), `/data/workspace` (the harness's) and `/run/helper` (the socket's: `helper`'s, and `agent`'s group may enter), starts the helper, then becomes the harness |
| the helper's restart loop and `helper.ts` | `helper`, the one trusted user | lists the logins, signs in, writes session files; logs to `/var/log/helper.log`, root's, so `agent` cannot write lines that look like the helper's |
| `sign-in.ts` and its Chrome | `helper`, a process per sign-in | reads the login and types it; ends within 120 s |
| `harness.ts`, and everything it starts | `agent`, the image's `USER` | the agent loop, the model's tools, the assistant's browser; `exec`, the shell and scheduled commands run as this user too |

## Why the harness is not trusted

A harness is large, and it reads untrusted input all day: the user's
messages, web pages, tool output, files the model wrote. As a trusted user,
one bug a prompt can steer runs with every password, and every feature has
to keep rules like "never fetch a URL the assistant chose" (a redirect to
`localhost:8081` goes as the trusted user). As `USER`, the harness cannot
read a login or the vault whatever it is made to do: s5x refuses it, by the
kernel's word on who opened the connection. What must be right shrinks to
the helper: two routes, a check of the website against the logins, a check
of the path, and the sign-in.

## A sign-in, step by step

1. The assistant needs github.com. The harness calls
   `signIn("github.com", "/login", "ada")`; `logins()` (`GET /logins`) says
   which websites have a login, by username and hint, never a password.
2. The helper reads the logins (`POST http://localhost:8081/v1/vault/logins/list`)
   and checks that one lists the website, with that username if one is
   named, and that the path is a path: it starts with `/`, and has no `//`,
   no backslash and no control character. It builds
   `https://github.com/login` itself, so the harness names a website and a
   page on it, never another host. No login lists the website:
   `{"signedIn": false, "reason": "no-login"}`, and no browser starts.
3. The helper runs `sign-in.ts` as a process of its own, so the password is
   never in the helper's memory. It reads the login
   (`POST /v1/vault/logins/get`) and its websites.
4. A fresh Chrome loads the page. `sign-in.ts` types the username and
   password by script in each field's own document, in one step with two
   checks: the document is https on one of the login's websites, and the
   field's form sends there too (to its submit button's `formaction`, else
   to the form's `action`). It submits the form, checking where it sends
   again. The script runs in a JavaScript world of its own, whose built-ins
   and DOM the page's scripts cannot redefine. A page that moved anywhere
   else, a form on the login's website that sends anywhere else, and a frame
   of another site that takes the focus, get nothing.
5. When the site asks for a code, `POST /v1/vault/logins/totp` gives one; s5x
   keeps the seed. A login with no seed: `"reason": "code-required"`.
6. Once the last submit moves the page on, the cookies a browser sends to
   the login's websites go to `/data/sessions/ada@github.com.json`
   (`github.com.json` when the harness names no username), which the helper
   writes and `agent` may only read, and the profile is deleted. A dialog, a
   form that stays put, 120 s, or SIGTERM ends the sign-in instead, with
   `"reason": "failed"` and one line in the helper's log on why, never the
   page's text; the profile is deleted all the same.
7. The helper answers `{"signedIn": true, "session": "/data/sessions/ada@github.com.json"}`,
   and the harness loads it into the assistant's browser:
   `agent-browser --state /data/sessions/ada@github.com.json open https://github.com/login`
   (the file is agent-browser's state format, `{cookies, origins}`).

The helper answers nothing else: any other route is 404, and a request
carrying `Origin` or `Sec-Fetch-Site`, which a page's would if the harness
relayed one, is 403. It follows no redirect for what it fetches itself.

## What the assistant gets

The session, which is what it asked for, and never the password or the seed.
A session cookie is a bearer credential: the assistant can use it, and copy
it out of the sandbox, until the site ends the session, and a domain cookie
(`.example.com`) reaches every host under that domain, not only the one it
signed in to. When the site ends the session, sign in again.

## Schedules

On a template with trusted users, code inside may add, change or delete a
schedule only as a trusted user, and the harness is not one. Change them from
your platform's own server, with your tenant key (`box.schedules.add`,
`s5x sandbox schedule add`): the API and the SDK change schedules with no
trusted-user check, since the key is yours. So the assistant, steered or not,
cannot leave a command behind to run later. A scheduled command runs as
`USER` too: one that needs a secret asks the helper, given a route of its
own for that, or the work is driven from your server. Passing schedule
changes through the helper is the fallback, and turns that protection off:
whatever can ask the helper, the assistant included, can then schedule
commands.

## Build it

The Dockerfile copies files from both directories, so build from this one:

```bash
docker build -f trusted-helper/Dockerfile -t ghcr.io/acme/assistant:1.4.0 .
docker push ghcr.io/acme/assistant:1.4.0
s5x template build ghcr.io/acme/assistant:1.4.0 --name assistant --trusted-users helper
```

To watch it start in Docker as s5x starts it, as root, run it as below; the
harness prints its uid, and the helper its own in `/var/log/helper.log`. The
seccomp flag is for a sign-in: Chrome's sandbox makes namespaces, which
Docker's default profile forbids and a sandbox's VM allows.

```bash
docker run --rm --user root --security-opt seccomp=unconfined ghcr.io/acme/assistant:1.4.0
```

Or from code, with the volume the start script expects at `/data`. The
script refuses a volume whose root is not root's 0755, or that holds a link
where it makes a directory, since root would follow it. A fresh volume's root
is root's on a template with trusted users; one that held files keeps its
owner, often `USER`. Before an older volume moves to trusted users, make its
root root's (`chown root:root`, `chmod 0755`) and check what is at its top:
an entry `USER` made there stays `USER`'s.

```ts
import { Sandbox, Template } from "s5x";

const build = await Template.build({
  image: "ghcr.io/acme/assistant:1.4.0", name: "assistant", trustedUsers: ["helper"],
});
for (const w of build.warnings) console.warn(`assistant build: ${w}`);
const box = await Sandbox.createIfNotExists({
  name: "user-4411", template: "assistant",
  volumes: [{ volume: "user-4411-data", path: "/data", create: true }],
});
```

## The sign-in's limits

`sign-in.ts` knows a form by the usual fields, in up to three steps. A site
that names its fields otherwise, puts up a CAPTCHA, or mails a code needs
code of your own; one that refuses headless Chrome can run Chromium under
`xvfb-run` without `--headless=new`. Its limits fail closed:

- **A form inside a frame**, of the same site or another, is not found: the
  sign-in fails, and nothing is typed.
- **It types with `document.execCommand("insertText")`**, which a page's
  scripts see as typing (`input` events), but sends no key presses: a site
  that waits for them stays on its form, and the sign-in fails.
- **A field in no form is submitted with Enter**, and where its value goes
  is up to the page's scripts, which is true of any page: they can read a
  field and send it anywhere. The form check is for the form a page
  declares.
- **It counts a sign-in done when the last submit is followed by a
  navigation**, and cannot tell one the page's own script started. At worst
  that is a success whose session does not work; the password still went
  only to the login's websites.

## Why not an agent-browser credential plugin

agent-browser (0.39.1) can resolve a password through a plugin
(`agent-browser auth login <name> --credential-provider <plugin>`), and a
plugin that calls `logins/get` is a few lines. It does not seal the sign-in
in a sandbox the assistant shares: agent-browser starts Chrome with
`--remote-debugging-port=0`, and each of its sessions serves a WebSocket
stream on `127.0.0.1` that takes mouse and keyboard input from any local
client without a token. Every user in the sandbox can connect to a port on
localhost, so the assistant's tools could drive a trusted user's browser
while it signs in, and read the password it typed. Sign in with
`sign-in.ts`, then hand agent-browser the session with `--state`.
