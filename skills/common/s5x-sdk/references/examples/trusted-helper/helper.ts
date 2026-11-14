// The trusted helper, as `helper`, the template's one trusted user: the only
// code here that may read a login or the vault, small enough to read whole.
// The harness, as `agent` (USER), asks it over a Unix socket for the logins,
// which hold no password, and for a sign-in, which answers a session file. It
// answers and logs no password, code or page text, and checks all it is sent.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { rmSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";

const SOCKET = "/run/helper/helper.sock";
const SIGN_IN = new URL("../sealed-sign-in/sign-in.ts", import.meta.url).pathname;
type Login = { id: string; websites: string[]; username: string; hint: string; hasTotp: boolean };

/** The sandbox's logins, from s5x: never a password or a seed. No redirect is
 *  followed, here or anywhere: one would send this user's request elsewhere. */
async function logins(): Promise<Login[]> {
  const res = await fetch("http://localhost:8081/v1/vault/logins/list", {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    redirect: "error", signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`POST /v1/vault/logins/list: ${res.status}`);
  return ((await res.json()) as { logins: Login[] }).logins;
}

/** A path on a website: from "/", with no "//" (which would name another
 *  host), no backslash (which a browser reads as "/") and no control
 *  character (which would break a log line). */
const PATH = /^(?!.*\/\/)\/[^\\\x00-\x1f\x7f-\x9f]{0,2000}$/;

/** Signs in to one of the logins' websites, by sign-in.ts as a process of its
 *  own: the password is never in this long-lived process's memory, and the
 *  sign-in ends within its own limit (the timeout is for one that cannot). */
async function signIn(website: string, path: string, username?: string) {
  // A website as s5x matches it: the login's, or its www. form.
  const lists = (l: Login) => l.websites.some((w) => website === w || website === `www.${w}`);
  if (!(await logins()).some((l) => lists(l) && (username === undefined || l.username === username))) {
    return { signedIn: false, reason: "no-login" };
  }
  // One file per login: two usernames on one website are two sessions.
  const session = `/data/sessions/${username === undefined ? "" : `${encodeURIComponent(username)}@`}${website}.json`;
  const child = spawn(process.execPath, [SIGN_IN, website, path, session, ...(username === undefined ? [] : [username])], {
    stdio: ["ignore", "ignore", "inherit"], timeout: 150_000, // its one line on why goes to this log
  });
  const [code] = await once(child, "exit");
  if (code === 0) return { signedIn: true, session };
  return { signedIn: false, reason: code === 3 ? "no-login" : code === 4 ? "code-required" : "failed" };
}

/** The request's JSON, as an object: {} for anything else, which no check passes. */
async function json(req: IncomingMessage): Promise<Record<string, unknown>> {
  let body = "";
  for await (const chunk of req) if ((body += chunk).length > 4096) return {};
  try { return Object(JSON.parse(body)); } catch { return {}; }
}

let signingIn = false;
const server = createServer(async (req, res) => {
  const answer = (status: number, body: object) =>
    res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
  // No browser reaches a Unix socket, but the harness could relay a page's
  // request here, as a proxy does: anything a browser sent is refused.
  if (req.headers.origin !== undefined || req.headers["sec-fetch-site"] !== undefined) return answer(403, { error: "browser" });
  try {
    if (req.method === "GET" && req.url === "/logins") {
      const list = await logins();
      return answer(200, { logins: list.map(({ websites, username, hint, hasTotp }) => ({ websites, username, hint, hasTotp })) });
    }
    if (req.method === "POST" && req.url === "/sign-in") {
      // One at a time: each starts a Chrome, and a steered harness could
      // otherwise start enough to run the sandbox out of memory.
      if (signingIn) return answer(409, { error: "busy" });
      const { website, path = "/", username } = await json(req);
      if (typeof website !== "string" || typeof path !== "string" || !PATH.test(path)
        || (username !== undefined && typeof username !== "string")) return answer(400, { error: "bad-request" });
      signingIn = true;
      try { return answer(200, await signIn(website, path, username)); } finally { signingIn = false; }
    }
    answer(404, { error: "not-found" });
  } catch (err) {
    console.error(`helper: ${req.method} ${req.url}: ${(err as Error).message}`);
    answer(500, { error: "failed" });
  }
});

// A Unix socket, not a port, which would answer every user and every page a
// browser here loads. Its directory (helper:agent 0750, made by start.sh) is
// what keeps a third user out, so the socket is writable by all. One left by
// the run before is removed first.
rmSync(SOCKET, { force: true });
server.listen({ path: SOCKET, writableAll: true }, () => {
  console.error(`helper runs as uid ${process.getuid!()} on ${SOCKET}`);
});
