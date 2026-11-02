import test from "node:test";
import assert from "node:assert/strict";

import {
  getClientIp,
  ipToLong,
  matchCidr,
  isTelegramIp,
  extractToken,
  parseTokenWhitelist,
  isTokenAllowed,
  isWebhookRequest,
  resolveWebhookTarget,
  handleWebhook,
  handleRequest,
} from "../index.js";

test("ipToLong converts IPv4 strings correctly", () => {
  assert.equal(ipToLong("0.0.0.0"), 0);
  assert.equal(ipToLong("255.255.255.255"), 4294967295);
  assert.equal(ipToLong("127.0.0.1"), 2130706433);
  assert.equal(ipToLong("invalid"), null);
  assert.equal(ipToLong("256.0.0.1"), null);
  assert.equal(ipToLong(""), null);
});

test("matchCidr checks CIDR inclusion correctly", () => {
  // Telegram 149.154.160.0/20 range (149.154.160.0 - 149.154.175.255)
  assert.equal(matchCidr("149.154.160.1", "149.154.160.0/20"), true);
  assert.equal(matchCidr("149.154.175.254", "149.154.160.0/20"), true);
  assert.equal(matchCidr("149.154.176.1", "149.154.160.0/20"), false);

  // Telegram 91.108.4.0/22 range (91.108.4.0 - 91.108.7.255)
  assert.equal(matchCidr("91.108.4.50", "91.108.4.0/22"), true);
  assert.equal(matchCidr("91.108.7.255", "91.108.4.0/22"), true);
  assert.equal(matchCidr("91.108.8.1", "91.108.4.0/22"), false);

  // Single IP /32
  assert.equal(matchCidr("192.168.1.1", "192.168.1.1/32"), true);
  assert.equal(matchCidr("192.168.1.1", "192.168.1.1"), true);
  assert.equal(matchCidr("192.168.1.2", "192.168.1.1"), false);
});

test("isTelegramIp identifies Telegram subnets and extra allowed IPs", () => {
  assert.equal(isTelegramIp("149.154.167.99"), true);
  assert.equal(isTelegramIp("91.108.5.2"), true);
  assert.equal(isTelegramIp("8.8.8.8"), false);
  assert.equal(isTelegramIp("1.1.1.1"), false);
  assert.equal(isTelegramIp("127.0.0.1"), false);

  // With extra allowed IPs
  assert.equal(isTelegramIp("127.0.0.1", ["127.0.0.1/32"]), true);
  assert.equal(isTelegramIp("10.0.0.5", ["10.0.0.0/24"]), true);
});

test("getClientIp extracts IP from headers", () => {
  const req1 = new Request("http://localhost", {
    headers: { "cf-connecting-ip": "149.154.167.1" },
  });
  assert.equal(getClientIp(req1), "149.154.167.1");

  const req2 = new Request("http://localhost", {
    headers: { "x-real-ip": "91.108.4.1" },
  });
  assert.equal(getClientIp(req2), "91.108.4.1");

  const req3 = new Request("http://localhost", {
    headers: { "x-forwarded-for": "91.108.4.2, 10.0.0.1" },
  });
  assert.equal(getClientIp(req3), "91.108.4.2");

  const req4 = new Request("http://localhost");
  assert.equal(getClientIp(req4), "");
});

test("extractToken retrieves bot token from path", () => {
  assert.equal(extractToken("/bot123456:ABC-DEF/sendMessage"), "123456:ABC-DEF");
  assert.equal(extractToken("/bot123456:ABC-DEF/getMe"), "123456:ABC-DEF");
  assert.equal(extractToken("/file/bot123456:ABC-DEF/photos/f.jpg"), "123456:ABC-DEF");
  assert.equal(extractToken("/webhook/bot123456:ABC-DEF"), "123456:ABC-DEF");
  assert.equal(extractToken("/webhook/123456:ABC-DEF"), "123456:ABC-DEF");
  assert.equal(extractToken("/123456:ABC-DEF/sendMessage"), "123456:ABC-DEF");
  assert.equal(extractToken("/webhook"), null);
  assert.equal(extractToken("/"), null);
});

test("isTokenAllowed validates tokens against whitelist", () => {
  const envTokens = "123:ABC, bot456:DEF; 789:GHI";

  // Allowed tokens (with or without 'bot' prefix)
  assert.equal(isTokenAllowed("123:ABC", envTokens), true);
  assert.equal(isTokenAllowed("bot123:ABC", envTokens), true);
  assert.equal(isTokenAllowed("456:DEF", envTokens), true);
  assert.equal(isTokenAllowed("bot456:DEF", envTokens), true);

  // Disallowed token
  assert.equal(isTokenAllowed("999:UNKNOWN", envTokens), false);
  assert.equal(isTokenAllowed(null, envTokens), false);

  // No whitelist configured -> allow all
  assert.equal(isTokenAllowed("any:token", undefined), true);
  assert.equal(isTokenAllowed("any:token", ""), true);
});

test("isWebhookRequest identifies webhook endpoints", () => {
  const req1 = new Request("http://proxy.local/webhook", { method: "POST" });
  assert.equal(isWebhookRequest(req1), true);

  const req2 = new Request("http://proxy.local/webhook/bot123:ABC", { method: "POST" });
  assert.equal(isWebhookRequest(req2), true);

  const req3 = new Request("http://proxy.local/hook", { method: "POST" });
  assert.equal(isWebhookRequest(req3), true);

  const req4 = new Request("http://proxy.local/bot123:ABC/sendMessage", { method: "POST" });
  assert.equal(isWebhookRequest(req4), false);
});

test("resolveWebhookTarget builds correct target URL", () => {
  const env = { WEBHOOK_TARGET_URL: "https://my-backend.com/webhook" };

  // Exact /webhook request
  const t1 = resolveWebhookTarget("http://proxy.local/webhook", env);
  assert.equal(t1, "https://my-backend.com/webhook");

  // Subpath forwarded
  const t2 = resolveWebhookTarget("http://proxy.local/webhook/bot123:ABC", env);
  assert.equal(t2, "https://my-backend.com/webhook/bot123:ABC");

  // Query parameter ?target= override
  const t3 = resolveWebhookTarget(
    "http://proxy.local/webhook?target=https%3A%2F%2Fother.com%2Fhook",
    env
  );
  assert.equal(t3, "https://other.com/hook");

  // Extra query parameters preserved
  const t4 = resolveWebhookTarget(
    "http://proxy.local/webhook?target=https%3A%2F%2Fother.com%2Fhook&token=secret123",
    env
  );
  assert.equal(t4, "https://other.com/hook?token=secret123");
});

test("handleRequest handles OPTIONS preflight", async () => {
  const req = new Request("http://proxy.local/bot123:ABC/getMe", { method: "OPTIONS" });
  const res = await handleRequest(req);
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
});

test("handleRequest returns service info on GET /", async () => {
  const req = new Request("http://proxy.local/", { method: "GET" });
  const res = await handleRequest(req);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.status, "ok");
});

test("handleRequest rejects disallowed HTTP methods", async () => {
  const req = new Request("http://proxy.local/bot123:ABC/sendMessage", { method: "PUT" });
  const res = await handleRequest(req);
  assert.equal(res.status, 405);
});

test("handleRequest enforces bot token whitelist for API calls", async () => {
  const env = { ALLOWED_TOKENS: "123456:ALLOWED_TOKEN" };

  // Disallowed token
  const reqBad = new Request("http://proxy.local/bot999999:FORBIDDEN/getMe", {
    method: "POST",
  });
  const resBad = await handleRequest(reqBad, env);
  assert.equal(resBad.status, 403);

  // Missing token
  const reqNoToken = new Request("http://proxy.local/unknown/path", {
    method: "POST",
  });
  const resNoToken = await handleRequest(reqNoToken, env);
  assert.equal(resNoToken.status, 403);
});

test("handleWebhook rejects non-Telegram IP with 403", async () => {
  const env = { WEBHOOK_TARGET_URL: "https://my-backend.com/webhook" };

  // Non-telegram IP (e.g. 8.8.8.8)
  const req = new Request("http://proxy.local/webhook", {
    method: "POST",
    headers: { "cf-connecting-ip": "8.8.8.8" },
    body: JSON.stringify({ update_id: 12345 }),
  });

  const res = await handleRequest(req, env);
  assert.equal(res.status, 403);
  const text = await res.text();
  assert.match(text, /Forbidden.*Telegram IPs/i);
});

test("handleWebhook returns 503 if target URL not configured for Telegram IP", async () => {
  const req = new Request("http://proxy.local/webhook", {
    method: "POST",
    headers: { "cf-connecting-ip": "149.154.167.1" },
    body: JSON.stringify({ update_id: 12345 }),
  });

  const res = await handleRequest(req, {});
  assert.equal(res.status, 503);
});

test("handleWebhook validates token whitelist if token is in webhook path", async () => {
  const env = {
    ALLOWED_TOKENS: "123456:ALLOWED",
    WEBHOOK_TARGET_URL: "https://my-backend.com/webhook",
  };

  const reqDisallowed = new Request("http://proxy.local/webhook/bot999999:BAD", {
    method: "POST",
    headers: { "cf-connecting-ip": "149.154.167.1" },
    body: JSON.stringify({ update_id: 12345 }),
  });

  const resDisallowed = await handleRequest(reqDisallowed, env);
  assert.equal(resDisallowed.status, 403);
  const text = await resDisallowed.text();
  assert.match(text, /Bot token not allowed/i);
});

test("end-to-end: API proxy forwards allowed token to Telegram API", async () => {
  const originalFetch = globalThis.fetch;
  let forwardedUrl = null;
  let forwardedHeaders = null;

  globalThis.fetch = async (req) => {
    forwardedUrl = req.url;
    forwardedHeaders = req.headers;
    return new Response(JSON.stringify({ ok: true, result: { id: 123 } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const req = new Request("http://proxy.local/bot123456:ALLOWED/getMe", {
      method: "GET",
      headers: { "cf-connecting-ip": "1.2.3.4", "x-client": "app" },
    });

    const res = await handleRequest(req, { ALLOWED_TOKENS: "123456:ALLOWED" });
    assert.equal(res.status, 200);
    assert.equal(forwardedUrl, "https://api.telegram.org/bot123456:ALLOWED/getMe");
    assert.equal(forwardedHeaders.get("cf-connecting-ip"), null);
    assert.equal(forwardedHeaders.get("x-client"), "app");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("end-to-end: Webhook forwards update from Telegram IP to target backend", async () => {
  const originalFetch = globalThis.fetch;
  let forwardedUrl = null;
  let forwardedHeaders = null;
  let forwardedBody = null;

  globalThis.fetch = async (req) => {
    forwardedUrl = req.url;
    forwardedHeaders = req.headers;
    forwardedBody = await req.json();
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const req = new Request("http://proxy.local/webhook/bot123456:ALLOWED", {
      method: "POST",
      headers: {
        "cf-connecting-ip": "149.154.167.50",
        "Content-Type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": "my-secret-token",
      },
      body: JSON.stringify({ update_id: 9999, message: { text: "hello" } }),
    });

    const res = await handleRequest(req, {
      ALLOWED_TOKENS: "123456:ALLOWED",
      WEBHOOK_TARGET_URL: "https://my-backend.com/tg-webhook",
    });

    assert.equal(res.status, 200);
    assert.equal(forwardedUrl, "https://my-backend.com/tg-webhook/bot123456:ALLOWED");
    assert.equal(forwardedHeaders.get("X-Telegram-Bot-Api-Secret-Token"), "my-secret-token");
    assert.equal(forwardedHeaders.get("x-forwarded-for"), "149.154.167.50");
    assert.deepEqual(forwardedBody, { update_id: 9999, message: { text: "hello" } });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("default export worker.fetch delegates to handleRequest", async () => {
  const workerModule = await import("../index.js");
  const worker = workerModule.default;
  assert.ok(worker && typeof worker.fetch === "function");

  const req = new Request("http://proxy.local/", { method: "GET" });
  const res = await worker.fetch(req, {});
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.status, "ok");
});


