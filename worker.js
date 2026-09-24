// Basic Auth gate in front of the explorer. `run_worker_first` in wrangler.toml
// sends every request through here, so index.html is only ever served after the
// credentials match over HTTPS. Without AUTH_USER and AUTH_PASS the Worker admits nobody.

const CHALLENGE = 'Basic realm="Market State Cube", charset="UTF-8"';
const TOKEN = /^[A-Za-z0-9+/]+={0,2}$/;

const sha256 = (text) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));

async function authorised(request, env) {
  if (!env.AUTH_USER || !env.AUTH_PASS) return false;
  const header = request.headers.get("Authorization") || "";
  const token = header.slice(6);
  if (!header.startsWith("Basic ") || !TOKEN.test(token) || token.length % 4) return false;
  const [supplied, expected] = await Promise.all([sha256(atob(token)), sha256(`${env.AUTH_USER}:${env.AUTH_PASS}`)]);
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
