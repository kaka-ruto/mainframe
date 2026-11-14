// The harness, as `agent`, the image's USER: a stand-in for your platform's
// whole harness, its agent loop and the assistant's shell, files and browser.
// It runs as the untrusted USER, as everything here but the helper does, so no
// bug in it, and no prompt that steers it, can reach a password: s5x refuses
// this user the vault and logins, and the helper answers it a session file,
// never a secret. It can run what the model asks for itself, as this user.
import { execFile } from "node:child_process";
import { request } from "node:http";
import { promisify } from "node:util";

export type Login = { websites: string[]; username: string; hint: string; hasTotp: boolean };
export type SignedIn =
  | { signedIn: true; session: string }
  | { signedIn: false; reason: "no-login" | "code-required" | "failed" };

/** One request to the trusted helper, over its Unix socket. */
function helper<T>(method: string, path: string, body?: object): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath: "/run/helper/helper.sock", method, path }, async (res) => {
      let text = "";
      for await (const chunk of res) text += chunk;
      if (res.statusCode === 200) resolve(JSON.parse(text) as T);
      else reject(new Error(`the helper answered ${method} ${path} with ${res.statusCode} ${text}`));
    });
    req.on("error", reject).end(body === undefined ? undefined : JSON.stringify(body));
  });
}

/** The logins the user stored, which the assistant may ask to use: websites,
 *  usernames and hints, never a password. */
export async function logins(): Promise<Login[]> {
  return (await helper<{ logins: Login[] }>("GET", "/logins")).logins;
}

/** Signs in to `website`, one a login lists, at `path` on it ("/" when left
 *  out), and loads the session into the assistant's browser. The helper
 *  builds the URL from the two, so the model can name a website and a page on
 *  it, never another host. A session cookie is a bearer credential: the
 *  assistant can use it until the site ends the session, and copy it out. */
export async function signIn(website: string, path?: string, username?: string): Promise<SignedIn> {
  const r = await helper<SignedIn>("POST", "/sign-in", { website, path, username });
  if (r.signedIn) await promisify(execFile)("agent-browser", ["--state", r.session, "open", `https://${website}${path ?? "/"}`]);
  return r;
}

if (import.meta.main) {
  // Who runs what, said at every start, so an image that gets it wrong shows
  // in the console log rather than in a leak.
  console.log(`harness runs as uid ${process.getuid!()}`);
  // Stands in for your agent loop, which keeps the process alive.
  setInterval(() => {}, 2 ** 30);
}
