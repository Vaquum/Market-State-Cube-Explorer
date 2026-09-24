// Basic Auth gate in front of the explorer. `run_worker_first` in wrangler.toml
// sends every request through here, so index.html is only ever served after the
// credentials match over HTTPS. Without AUTH_USER and AUTH_PASS the Worker admits nobody.

const CHALLENGE = 'Basic realm="Market State Cube", charset="UTF-8"';
const CREDENTIALS = /^basic +([A-Za-z0-9+/]+={0,2})$/i;

const sha256 = (bytes) => crypto.subtle.digest("SHA-256", bytes);
const utf8 = (text) => new TextEncoder().encode(text);
const decoded = (token) => Uint8Array.from(atob(token), (c) => c.charCodeAt(0));

async function authorised(request, env) {
  if (!env.AUTH_USER || !env.AUTH_PASS) return false;
  const match = CREDENTIALS.exec(request.headers.get("Authorization") || "");
  if (!match || match[1].length % 4) return false;
  const [supplied, expected] = await Promise.all([sha256(decoded(match[1])), sha256(utf8(`${env.AUTH_USER}:${env.AUTH_PASS}`))]);
  return crypto.subtle.timingSafeEqual(supplied, expected);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.protocol === "http:") {
      url.protocol = "https:";
      return Response.redirect(url.href, 301);
    }
    if (!(await authorised(request, env))) {
      return new Response("Authentication required.", {
        status: 401,
        headers: { "WWW-Authenticate": CHALLENGE, "Cache-Control": "no-store" },
      });
    }
    return env.ASSETS.fetch(request);
  },
};
