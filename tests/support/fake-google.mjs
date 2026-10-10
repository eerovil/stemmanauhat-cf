// A stand-in for Google's sign-in, for the browser tests only. The Worker is
// pointed here by GOOGLE_AUTH_URL and GOOGLE_TOKEN_URL, which only the test
// configuration sets. /auth shows an "account chooser" with an email box;
// /token hands back an unsigned id token with the claims Google would send.
import { createServer } from "node:http";

const port = Number(process.env.FAKE_GOOGLE_PORT ?? "8788");
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const escape = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  if (url.pathname === "/health") return res.end("ok");

  if (url.pathname === "/auth") {
    const keep = ["client_id", "redirect_uri", "state", "nonce"]
      .map((k) => `<input type="hidden" name="${k}" value="${escape(url.searchParams.get(k) ?? "")}">`).join("");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(`<!doctype html><title>Fake Google</title><form action="/approve">${keep}
      <label>Email <input name="email" aria-label="Email"></label><button>Continue</button></form>`);
  }

  if (url.pathname === "/approve") {
    const p = url.searchParams;
    const code = b64({ email: p.get("email"), nonce: p.get("nonce"), aud: p.get("client_id") });
    const back = new URL(p.get("redirect_uri"));
    back.searchParams.set("code", code);
    back.searchParams.set("state", p.get("state"));
    res.writeHead(302, { Location: back.toString() });
    return res.end();
  }

  if (url.pathname === "/token" && req.method === "POST") {
    let body = "";
    for await (const chunk of req) body += chunk;
    const form = new URLSearchParams(body);
    const claims = JSON.parse(Buffer.from(form.get("code") ?? "", "base64url").toString());
    const idToken = [b64({ alg: "none" }), b64({
      iss: "https://accounts.google.com",
      aud: form.get("client_id"),
      exp: Math.floor(Date.now() / 1000) + 3600,
      email: claims.email,
      email_verified: true,
      nonce: claims.nonce,
      sub: `fake-${claims.email}`,
    }), "fake"].join(".");
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ id_token: idToken }));
  }

  res.statusCode = 404;
  res.end();
}).listen(port, "127.0.0.1");
