// The sealed sign-in: signs in to a website for the assistant from a browser
// the assistant cannot reach, and hands it the session, never the password.
// The trusted helper (../trusted-helper/helper.ts) runs it as a trusted user,
// since only they may read a login, with a website a login lists and a path
// it checked:
//
//   node sign-in.ts github.com /login /data/sessions/github.com.json [username]
//
// It exits 0 signed in, 3 when no login lists the website (or none with that
// username), 4 when the site asks for a code and the login has no TOTP seed,
// and 1 for anything else, with one line on stderr that says why.
//
// - Chrome starts fresh for each sign-in, with a throwaway profile in this
//   user's home, deleted after: nothing of the sign-in outlives it but the
//   session file.
// - It is driven over --remote-debugging-pipe, two file descriptors of this
//   process. A debugging port would answer every user in the sandbox, so the
//   assistant's tools could drive this browser and read what it types.
// - Chrome's sandbox stays on (no --no-sandbox): the sign-in page runs as a
//   trusted user, and the sandbox keeps a hostile page from that user's reach.
// - The machine's Chrome policies (chrome-policy.json) turn the password
//   manager, its leak check and autofill off.
// - The password goes from s5x into the form: never onto a command line, into
//   a log, or into a file. It is typed by script in the field's own document,
//   in one step with the check that the document is one of the login's
//   websites and that the field's form sends it to one of them, so no other
//   frame or page can take focus in between, and in a JavaScript world of this
//   script's own, whose built-ins and DOM the page's scripts cannot redefine.
//   Errors name what failed, never the page's text.
// - Every sign-in ends within LIMIT_S, and on SIGTERM or SIGINT, with Chrome
//   killed and the profile deleted.
// - The session file holds the cookies of the login's websites, in
//   agent-browser's state format, which `agent-browser --state <file>` loads.
//
// Node 24 runs it as it is. It knows a sign-in form by the usual fields (a
// username, a password, a one-time code), in up to three steps; a site that
// names its fields otherwise needs its own selectors in FIELDS.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable, Writable } from "node:stream";
import { setTimeout as sleep } from "node:timers/promises";

const S5X = "http://localhost:8081/v1";
const LIMIT_S = 120;
const CHROME = ["/usr/bin/chromium", "/usr/bin/google-chrome"].find((p) => existsSync(p));
const FIELDS = {
  username: "input[autocomplete~=username], input[type=email], input[name*=user i]:not([type=password]), " +
    "input[name*=login i]:not([type=password]), input[name*=email i]:not([type=password])",
  password: "input[type=password]",
  code: "input[autocomplete=one-time-code], input[name*=otp i], input[name*=totp i]",
};

// The CLI's exit statuses its caller tells apart (above).
const NO_LOGIN = 3;
const CODE_REQUIRED = 4;

export type Cookie = { name: string; value: string; domain: string; path: string };
type Shown = { url: string; username: boolean; password: boolean; code: boolean };
// A protocol message: an answer (id) or an event (method), whose params differ by event.
type Message = { id?: number; method?: string; sessionId?: string; params?: any; result?: unknown; error?: { message: string } };

/** The hosts s5x finds a login for, each website and its `www.` form: the
 *  only hosts its password and code are typed into. */
export function loginHosts(websites: string[]): string[] {
  return websites.flatMap((w) => [w, `www.${w}`]);
}

/** The cookies a browser sends to the login's websites (RFC 6265's domain
 *  match): a host-only cookie to its own host, a domain cookie
 *  (`.example.com`) to that host and every host under it. */
export function sessionCookies<C extends Cookie>(cookies: C[], websites: string[]): C[] {
  const hosts = loginHosts(websites);
  return cookies.filter((c) => c.domain.startsWith(".")
    ? hosts.some((h) => h === c.domain.slice(1) || h.endsWith(c.domain))
    : hosts.includes(c.domain));
}

/** One request to s5x from inside the sandbox. A refusal's detail says what
 *  to fix, and never holds a password; a 404 ends the CLI with `on404`. */
async function api<T>(path: string, body: object, on404 = 1): Promise<T> {
  const res = await fetch(S5X + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    redirect: "error", // s5x never redirects: one that did is not s5x
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text;
    try { detail = JSON.parse(text).detail ?? text; } catch { /* not JSON */ }
    throw Object.assign(new Error(`POST ${path}: ${res.status} ${detail}`), { exit: res.status === 404 ? on404 : 1 });
  }
  return JSON.parse(text) as T;
}

/** Runs in the page: what it shows of a sign-in form, once it has loaded. */
function shownInPage(fields: typeof FIELDS): Shown | null {
  if (document.readyState !== "complete" || location.href === "about:blank") return null;
  const shows = (selector: string) => [...document.querySelectorAll<HTMLInputElement>(selector)]
    .some((el) => !el.disabled && !el.readOnly && el.getClientRects().length > 0);
  return { url: location.href, username: shows(fields.username), password: shows(fields.password), code: shows(fields.code) };
}

/** Runs in the page: the first visible, editable field matching `selector`. */
function fieldInPage(selector: string): HTMLInputElement | null {
  return [...document.querySelectorAll<HTMLInputElement>(selector)]
    .find((el) => !el.disabled && !el.readOnly && el.getClientRects().length > 0) ?? null;
}

/** Runs on a field, in its own document, in one step no other frame or page
 *  can come between, and only while that document is an https page of one of
 *  `hosts` and the field's form, if it has one, sends to one of `hosts` too:
 *  to the `formaction` of the submit button Enter would press, else to the
 *  form's action. With `text`, types it into the field as a keyboard would
 *  (the page's scripts see an `input` event); with none, submits the form by
 *  that button. Answers "" when done, "elsewhere" or "sends-elsewhere" when a
 *  check failed, "untyped" when the field did not take the text, and "no-form"
 *  for a submit with no form. */
function inField(this: HTMLInputElement, hosts: string[], text?: string): string {
  const at = this.ownerDocument.location;
  if (at.protocol !== "https:" || !hosts.includes(at.hostname)) return "elsewhere";
  const form = this.form;
  let button: HTMLButtonElement | undefined;
  if (form) {
    // By the prototype's getters: a field named "action" (many sign-in forms
    // have one) or "elements" hides the form's own property of that name.
    const own = <T>(name: string) => Object.getOwnPropertyDescriptor(HTMLFormElement.prototype, name)!.get!.call(form) as T;
    button = [...own<HTMLFormControlsCollection>("elements")]
      .find((el) => (el as HTMLButtonElement).type === "submit") as HTMLButtonElement | undefined;
    const to = new URL(button?.hasAttribute("formaction") ? button.formAction : own<string>("action"));
    if (to.protocol !== "https:" || !hosts.includes(to.hostname)) return "sends-elsewhere";
  }
  if (text === undefined) {
    if (!form) return "no-form";
    if (button) button.click();
    else HTMLFormElement.prototype.requestSubmit.call(form);
    return "";
  }
  this.focus();
  this.select();
  this.ownerDocument.execCommand("insertText", false, text);
  return this.value === text ? "" : "untyped";
}

// Why inField refused, for an error, which never holds the page's text.
const REFUSED: Record<string, string> = {
  elsewhere: "its page is not one of the login's websites",
  "sends-elsewhere": "its form sends to a host that is not one of the login's websites",
};

/** Signs in to `website` with the login s5x finds for it, starting at `path`
 *  on it, and writes the session to `out`. */
export async function signIn(website: string, path: string, out: string, username?: string): Promise<void> {
  // The start page is built here, from the website and a path on it, never
  // taken whole: a path that names another host ("//evil.example") is refused.
  const start = new URL(path, `https://${website}`);
  if (!path.startsWith("/") || start.hostname !== website) throw new Error(`${path} is not a path on ${website}`);
  const url = start.href;
  if (!CHROME) throw new Error("no Chrome here: install chromium, or google-chrome-stable");
  // The body of `logins/get` and `logins/totp`: no username is any login, and
  // `""` the one with none (JSON.stringify drops an undefined, and keeps "").
  const query = { website, username };
  const login = await api<{ id: string; username: string; password: string }>("/vault/logins/get", query, NO_LOGIN);
  const { logins } = await api<{ logins: { id: string; websites: string[] }[] }>("/vault/logins/list", {});
  const websites = logins.find((l) => l.id === login.id)?.websites;
  if (!websites) throw new Error(`login ${login.id} was deleted while signing in`);
  const hosts = loginHosts(websites);

  const profile = mkdtempSync(join(homedir(), ".sign-in-"));
  // Chrome's scratch files, which a killed Chrome leaves, in a directory of
  // their own, 0700: a short path, since Chrome's sockets live in it.
  const scratch = mkdtempSync(join(tmpdir(), "sign-in-"));
  const chrome = spawn(CHROME, [
    "--headless=new", "--remote-debugging-pipe", `--user-data-dir=${profile}`,
    // No keyring in a sandbox: without this Chrome may wait for one.
    "--password-store=basic", "--no-first-run", "--no-default-browser-check", "about:blank",
  ], {
    stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"],
    // Chrome keeps its crash reports, which can hold what a page held, under
    // CHROME_CONFIG_HOME, not --user-data-dir: in the profile, they go with it.
    env: { ...process.env, CHROME_CONFIG_HOME: profile, TMPDIR: scratch },
  });
  const exited = once(chrome, "exit").catch(() => {}); // a failed spawn has no exit
  const alive = () => chrome.exitCode === null && chrome.signalCode === null;
  // A page that never answers, or a signal, kills Chrome: every call waiting
  // on it fails, and `finally` deletes the profile and the scratch files.
  let stopped = "";
  const stop = (why: string) => { stopped ||= why; chrome.kill("SIGKILL"); };
  const watchdog = setTimeout(() => stop(`no sign-in within ${LIMIT_S} s`), LIMIT_S * 1000);
  const onSignal = (signal: NodeJS.Signals) => stop(`stopped by ${signal}`);
  process.on("SIGTERM", onSignal).on("SIGINT", onSignal);

  // The DevTools protocol over Chrome's pipe: JSON messages, each ended by a
  // NUL byte, written to the browser's fd 3 and read from its fd 4.
  const toChrome = chrome.stdio[3] as Writable;
  const fromChrome = chrome.stdio[4] as Readable;
  const waiting = new Map<number, (m: Message) => void>();
  let onEvent = (_m: Message) => {};
  let lastId = 0;
  let partial = "";
  fromChrome.setEncoding("utf8");
  fromChrome.on("data", (chunk: string) => {
    const messages = (partial + chunk).split("\0");
    partial = messages.pop()!;
    for (const m of messages.map((raw) => JSON.parse(raw) as Message)) {
      if (typeof m.id === "number") waiting.get(m.id)?.(m), waiting.delete(m.id);
      else onEvent(m);
    }
  });
  // Chrome's end is told by its exit, below, not by the pipe's errors.
  for (const end of [toChrome, fromChrome]) end.on("error", () => {});
  chrome.on("exit", () => {
    for (const answer of waiting.values()) answer({ error: { message: "Chrome exited" } });
    waiting.clear();
  });
  const send = <T>(method: string, params: object = {}, sessionId?: string): Promise<T> => {
    if (!alive()) return Promise.reject(new Error(`${method}: Chrome exited`));
    const id = ++lastId;
    toChrome.write(JSON.stringify({ id, method, params, sessionId }) + "\0");
    return new Promise((resolve, reject) => waiting.set(id, (m) =>
      m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result as T)));
  };

  let started = false;
  try {
    await once(chrome, "spawn");
    started = true;
    const { targetId } = await send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
    const tab = <T>(method: string, params: object = {}) => send<T>(method, params, sessionId);

    let mainFrame = "";
    let navigations = 0;
    let dialog = "";
    onEvent = (m) => {
      if (m.sessionId !== sessionId) return;
      if (m.method === "Page.frameNavigated" && !m.params.frame.parentId) navigations++;
      else if (m.method === "Page.navigatedWithinDocument" && m.params.frameId === mainFrame) navigations++;
      else if (m.method === "Page.javascriptDialogOpening") {
        // A dialog stops the page until it is answered: dismissed here, and
        // the sign-in fails on it, since it is most often "wrong password".
        // Its type is named, and never its text, which is the page's.
        dialog ||= String(m.params.type);
        tab("Page.handleJavaScriptDialog", { accept: false }).catch(() => {});
      }
    };
    const noDialog = () => { if (dialog) throw new Error(`the site answered with a dialog (${dialog})`); };
    await tab("Page.enable");

    const inPage = async <T>(fn: (arg: never) => T, arg: unknown): Promise<T | null> => {
      const r = await tab<{ result: { value: T }; exceptionDetails?: unknown }>("Runtime.evaluate", {
        expression: `(${fn})(${JSON.stringify(arg)})`, returnByValue: true,
      }).catch((err) => {
        if (!alive()) throw err;
        return null; // a navigation replaced the document mid-call
      });
      return r && !r.exceptionDetails ? r.result.value : null;
    };
    // A call on a field that failed: Chrome's exit as it is, else the page's change.
    const pageChanged = (kind: string) => (err: Error): never => {
      if (!alive()) throw err;
      throw new Error(`the page changed under the ${kind} field: ${err.message}`);
    };
    const onField = async <T>(kind: string, objectId: string, fn: unknown, args: unknown[] = []): Promise<T> => {
      const r = await tab<{ result: { value: T }; exceptionDetails?: unknown }>("Runtime.callFunctionOn", {
        objectId, functionDeclaration: String(fn), arguments: args.map((value) => ({ value })), returnByValue: true,
      }).catch(pageChanged(kind));
      noDialog();
      if (r.exceptionDetails) throw new Error(`the ${kind} field's page threw`);
      return r.result.value;
    };
    // Settled: the page changed from `before` and held still for a second
    // (a new page, a script's next step, or an error), or 20 s passed.
    const settle = async (before: string): Promise<Shown | null> => {
      let last = before;
      for (let waited = 0, still = 0; waited < 20_000 && still < 4; waited += 250) {
        await sleep(250);
        const now = JSON.stringify(await inPage(shownInPage, FIELDS));
        still = now !== "null" && now !== before && now === last ? still + 1 : 0;
        last = now;
      }
      noDialog();
      return JSON.parse(last);
    };
    const type = async (kind: keyof typeof FIELDS, text: string): Promise<string> => {
      // The field, found and typed into from a world of this script's own in
      // the page's document, made afresh: its built-ins and DOM wrappers are
      // its own, so nothing the page's scripts redefine reaches the check, and
      // a navigation destroys it with the document.
      const r = await tab<{ executionContextId: number }>("Page.createIsolatedWorld", { frameId: mainFrame, worldName: "sign-in" })
        .then(({ executionContextId }) => tab<{ result: { objectId?: string }; exceptionDetails?: unknown }>("Runtime.evaluate", {
          expression: `(${fieldInPage})(${JSON.stringify(FIELDS[kind])})`, contextId: executionContextId,
        }))
        .catch(pageChanged(kind));
      // A search that threw answers the exception, whose objectId is no field.
      if (r.exceptionDetails) throw new Error(`the search for the ${kind} field threw in its page`);
      const field = r.result.objectId;
      if (!field) throw new Error(`the ${kind} field went away`);
      const refused = await onField<string>(kind, field, inField, [hosts, text]);
      if (REFUSED[refused]) throw new Error(`the ${kind} was not typed: ${REFUSED[refused]}`);
      if (refused) throw new Error(`the ${kind} field did not take it`);
      return field;
    };
    // Submits the field's form, checked again, since the page's scripts may
    // have changed where it sends once a value was typed, or presses Enter
    // in a field with none; says whether the page moved on: navigated, or
    // changed its URL.
    const submit = async (kind: string, field: string, shown: Shown) => {
      const before = navigations;
      const refused = await onField<string>(kind, field, inField, [hosts]);
      if (REFUSED[refused]) throw new Error(`the ${kind} was not sent: ${REFUSED[refused]}`);
      if (refused === "no-form") {
        await onField(kind, field, "function () { this.focus(); }");
        const enter = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 };
        await tab("Input.dispatchKeyEvent", { type: "keyDown", text: "\r", ...enter });
        await tab("Input.dispatchKeyEvent", { type: "keyUp", ...enter });
      }
      return { next: await settle(JSON.stringify(shown)), moved: navigations > before };
    };

    const { frameId, errorText } = await tab<{ frameId: string; errorText?: string }>("Page.navigate", { url });
    if (errorText) throw new Error(`${url}: ${errorText}`);
    mainFrame = frameId;
    let shown = await settle("null");
    let moved = false;
    const typed = new Set<string>();
    // A username, a password and a code, on one page or several. Each is
    // typed once: a site that asks again refused it.
    while (shown) {
      let kind: keyof typeof FIELDS;
      let field: string;
      if (shown.code) {
        if (typed.has("code")) throw new Error("the site refused the code: a second sign-in within one step gets the same code, which a site takes once");
        kind = "code";
        const { code } = await api<{ code: string }>("/vault/logins/totp", query, CODE_REQUIRED);
        field = await type(kind, code);
      } else if (shown.password) {
        if (typed.has("password")) throw new Error("the site asked for the password again: a wrong one, or a step this example does not know");
        if (shown.username) await type("username", login.username);
        kind = "password";
        field = await type(kind, login.password);
      } else if (shown.username && !typed.has("password")) {
        if (typed.has("username")) throw new Error("the site asked for the username again");
        kind = "username";
        field = await type(kind, login.username);
      } else break;
      typed.add(kind);
      ({ next: shown, moved } = await submit(kind, field, shown));
    }
    if (!typed.has("password")) throw new Error(`${url} showed no sign-in form`);
    // Signed in only if the last submit moved the page on: a form that stayed
    // put refused it, or never sent it.
    if (!moved) throw new Error("the site stayed on its sign-in form");

    const { cookies } = await send<{ cookies: Cookie[] }>("Storage.getCookies");
    // Written whole and renamed into place, so the assistant's browser never
    // reads half a file. 0640: in /data/sessions, the agent group's to read.
    // "wx": a file, or a link, already at that name fails the write.
    const tmp = `${out}.${process.pid}`;
    writeFileSync(tmp, JSON.stringify({ cookies: sessionCookies(cookies, websites), origins: [] }), { mode: 0o640, flag: "wx" });
    renameSync(tmp, out);
  } catch (err) {
    throw stopped ? new Error(stopped) : err;
  } finally {
    clearTimeout(watchdog);
    process.off("SIGTERM", onSignal).off("SIGINT", onSignal);
    if (started && alive()) {
      await send("Browser.close").catch(() => {});
      const closed = await Promise.race([exited.then(() => true), sleep(10_000, false, { ref: false })]);
      if (!closed) chrome.kill("SIGKILL");
    }
    await exited;
    for (const dir of [profile, scratch]) rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
}

if (import.meta.main) {
  const [website, path, out, username] = process.argv.slice(2);
  if (!website || !path || !out) {
    console.error("usage: node sign-in.ts <website> <path> <session file> [username]");
    process.exit(2);
  }
  try {
    await signIn(website, path, out, username);
  } catch (err) {
    // One line, for the caller's log: it names what failed, never a password,
    // a code or the page's text.
    console.error(`sign-in.ts: ${website}: ${(err as Error).message}`);
    process.exitCode = (err as { exit?: number }).exit ?? 1;
  }
}
