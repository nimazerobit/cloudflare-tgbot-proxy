// ============================================================================
// CONFIGURATION DEFAULTS (OPTIONAL)
// ============================================================================
// You can set these directly here for quick dashboard deployment, OR configure
// them via Cloudflare Dashboard (Worker -> Settings -> Variables and Secrets).
// Environment variables configured in Cloudflare will always take precedence.
export const DEFAULT_ALLOWED_TOKENS = ""; // e.g. "123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"
export const DEFAULT_WEBHOOK_TARGET_URL = ""; // e.g. "https://your-server.com/api/bot-webhook"
export const DEFAULT_ALLOWED_WEBHOOK_IPS = ""; // e.g. "127.0.0.1/32"

// ============================================================================
// CONSTANTS & HEADERS
// ============================================================================
export const TELEGRAM_API_HOST = "api.telegram.org";

// Telegram official IPv4 subnets for webhooks
export const TELEGRAM_SUBNETS = ["149.154.160.0/20", "91.108.4.0/22"];

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Requested-With, X-Telegram-Bot-Api-Secret-Token",
  "Access-Control-Max-Age": "86400",
};

export const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
};

export function getHeaders(extra = {}) {
  return {
    ...CORS_HEADERS,
    ...SECURITY_HEADERS,
    ...extra,
  };
}

// ============================================================================
// IP & CIDR HELPERS
// ============================================================================
export function getClientIp(request) {
  const headers = request.headers;
  const cfIp = headers.get("cf-connecting-ip");
  if (cfIp) return cfIp.trim();

  const realIp = headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();

  return "";
}

export function ipToLong(ip) {
  if (!ip || typeof ip !== "string") return null;
  const parts = ip.trim().split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => isNaN(n) || n < 0 || n > 255)) return null;
  return ((nums[0] << 24) | (nums[1] << 16) | (nums[2] << 8) | nums[3]) >>> 0;
}

export function matchCidr(ip, cidr) {
  if (!cidr || typeof cidr !== "string") return false;
  const [range, bitsStr = "32"] = cidr.split("/");
  const bits = Number(bitsStr);
  if (isNaN(bits) || bits < 0 || bits > 32) return false;

  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  const ipLong = ipToLong(ip);
  const rangeLong = ipToLong(range);
  if (ipLong === null || rangeLong === null) return false;

  return (ipLong & mask) >>> 0 === (rangeLong & mask) >>> 0;
}

export function isTelegramIp(ip, extraRanges = []) {
  if (!ip) return false;
  const subnets = [...TELEGRAM_SUBNETS, ...extraRanges];
  return subnets.some((cidr) => matchCidr(ip, cidr));
}

// ============================================================================
// TOKEN AUTHENTICATION
// ============================================================================
export function extractToken(pathname) {
  if (!pathname || typeof pathname !== "string") return null;
  const botMatch = pathname.match(/\/bot([^\/]+)/i);
  if (botMatch) return botMatch[1];
  const directMatch = pathname.match(/(?:^|\/)(\d+:[A-Za-z0-9_-]+)/);
  return directMatch ? directMatch[1] : null;
}

export function parseTokenWhitelist(envVal) {
  if (!envVal) return null;
  const list = (typeof envVal === "string" ? envVal : String(envVal))
    .split(/[,;\s]+/)
    .map((t) => t.trim().replace(/^bot/i, ""))
    .filter(Boolean);
  return list.length > 0 ? new Set(list) : null;
}

export function isTokenAllowed(token, allowedTokensEnv) {
  const whitelist = parseTokenWhitelist(allowedTokensEnv);
  if (!whitelist) return true;
  if (!token) return false;
  return whitelist.has(token.trim().replace(/^bot/i, ""));
}

// ============================================================================
// PROXY FORWARDING
// ============================================================================
export async function forwardRequest(
  request,
  targetUrl,
  { clientIp = "" } = {},
) {
  const headers = new Headers(request.headers);
  headers.delete("cf-connecting-ip");
  headers.delete("x-real-ip");
  headers.delete("x-forwarded-for");
  headers.delete("host");

  if (clientIp) {
    headers.set("x-forwarded-for", clientIp);
    headers.set("x-real-ip", clientIp);
  }

  const upstreamRequest = new Request(targetUrl, {
    method: request.method,
    headers,
    body:
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : request.body,
    redirect: "follow",
    ...(request.body ? { duplex: "half" } : {}),
  });

  try {
    const response = await fetch(upstreamRequest, {
      cf: { cacheEverything: false },
    });

    const responseHeaders = new Headers(response.headers);
    for (const [key, value] of Object.entries(getHeaders())) {
      responseHeaders.set(key, value);
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    return new Response("Bad Gateway", {
      status: 502,
      headers: getHeaders({ "Content-Type": "text/plain" }),
    });
  }
}

// ============================================================================
// WEBHOOK HANDLING
// ============================================================================
export function isWebhookRequest(request, env = {}) {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/webhook") || url.pathname.startsWith("/hook")) {
    return true;
  }
  const targetBase =
    env.WEBHOOK_TARGET_URL ||
    env.WEBHOOK_FORWARD_URL ||
    DEFAULT_WEBHOOK_TARGET_URL;
  if (targetBase && request.method === "POST") {
    const extra = (env.ALLOWED_WEBHOOK_IPS || DEFAULT_ALLOWED_WEBHOOK_IPS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const ip = getClientIp(request);
    if (isTelegramIp(ip, extra)) return true;
  }
  return false;
}

export function resolveWebhookTarget(requestUrl, env = {}) {
  const incoming = new URL(requestUrl);
  const queryTarget =
    incoming.searchParams.get("target") || incoming.searchParams.get("url");
  const base =
    queryTarget ||
    env.WEBHOOK_TARGET_URL ||
    env.WEBHOOK_FORWARD_URL ||
    env.BOT_UPDATE_FORWARD_URL ||
    DEFAULT_WEBHOOK_TARGET_URL;
  if (!base) return null;

  const target = new URL(base);
  if (target.pathname === "/" || target.pathname === "") {
    target.pathname = incoming.pathname;
  } else if (
    incoming.pathname.startsWith("/webhook/") ||
    incoming.pathname.startsWith("/hook/")
  ) {
    const subpath = incoming.pathname.replace(/^\/(?:webhook|hook)/, "");
    target.pathname = target.pathname.replace(/\/$/, "") + subpath;
  }

  const searchParams = new URLSearchParams(incoming.searchParams);
  searchParams.delete("target");
  searchParams.delete("url");
  const qs = searchParams.toString();
  target.search = qs ? `?${qs}` : "";

  return target.toString();
}

export async function handleWebhook(request, env = {}) {
  const clientIp = getClientIp(request);
  const extraIps = (
    env.ALLOWED_WEBHOOK_IPS ||
    DEFAULT_ALLOWED_WEBHOOK_IPS ||
    ""
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // Strictly enforce Telegram IP restriction for webhooks
  if (!isTelegramIp(clientIp, extraIps)) {
    return new Response("Forbidden: Webhooks only allowed from Telegram IPs", {
      status: 403,
      headers: getHeaders({ "Content-Type": "text/plain" }),
    });
  }

  // If token whitelist is configured, check token if present in path/query
  const allowedTokens =
    env.ALLOWED_TOKENS || env.BOT_TOKEN_WHITELIST || DEFAULT_ALLOWED_TOKENS;
  if (allowedTokens) {
    const url = new URL(request.url);
    const token = extractToken(url.pathname) || url.searchParams.get("token");
    if (token && !isTokenAllowed(token, allowedTokens)) {
      return new Response("Forbidden: Bot token not allowed", {
        status: 403,
        headers: getHeaders({ "Content-Type": "text/plain" }),
      });
    }
  }

  const targetUrl = resolveWebhookTarget(request.url, env);
  if (!targetUrl) {
    return new Response(
      "Service Unavailable: Webhook target URL not configured",
      {
        status: 503,
        headers: getHeaders({ "Content-Type": "text/plain" }),
      },
    );
  }

  return forwardRequest(request, targetUrl, { clientIp });
}

// ============================================================================
// MAIN REQUEST DISPATCHER
// ============================================================================
export async function handleRequest(request, env = {}) {
  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: getHeaders() });
  }

  // Health check / Service info
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/") {
    return new Response(
      JSON.stringify({ status: "ok" }),
      {
        status: 200,
        headers: getHeaders({ "Content-Type": "application/json" }),
      },
    );
  }

  // Handle Webhooks
  if (isWebhookRequest(request, env)) {
    return handleWebhook(request, env);
  }

  // API Proxy only allows GET and POST
  if (!["GET", "POST"].includes(request.method)) {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: getHeaders({
        Allow: "GET, POST, OPTIONS",
        "Content-Type": "text/plain",
      }),
    });
  }

  // Check Bot Token Whitelist
  const allowedTokens =
    env.ALLOWED_TOKENS || env.BOT_TOKEN_WHITELIST || DEFAULT_ALLOWED_TOKENS;
  if (allowedTokens) {
    const token = extractToken(url.pathname);
    if (!token || !isTokenAllowed(token, allowedTokens)) {
      return new Response("Forbidden: Bot token not allowed or missing", {
        status: 403,
        headers: getHeaders({ "Content-Type": "text/plain" }),
      });
    }
  }

  // Forward request to Telegram API
  const targetUrl = new URL(request.url);
  targetUrl.hostname = TELEGRAM_API_HOST;
  targetUrl.protocol = "https:";
  targetUrl.port = "443";

  return forwardRequest(request, targetUrl.toString());
}

export default {
  fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  },
};
