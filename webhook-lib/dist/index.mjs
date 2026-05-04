// src/index.ts
var WebhookLibError = class extends Error {
  status;
  body;
  /** True when the request never completed (network, refused connection, timeout, etc.). */
  transportFailure;
  constructor(message, status, body, transportFailure2 = false) {
    super(message);
    this.name = "WebhookLibError";
    this.status = status;
    this.body = body;
    this.transportFailure = transportFailure2;
  }
};
function normalizeBase(endpoint) {
  const s = endpoint.trim();
  if (!s) {
    throw new Error("createWebhooks: endpoint is required");
  }
  return s.replace(/\/+$/, "");
}
function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function isRetryableEmitStatus(status) {
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}
function isRetryableFetchError(err) {
  if (err instanceof WebhookLibError) return false;
  if (err instanceof TypeError) return true;
  if (err instanceof DOMException && err.name === "AbortError") return false;
  if (err instanceof Error && err.name === "AbortError") return false;
  return false;
}
function flattenErrorCauses(err, maxDepth = 8) {
  const out = [];
  let cur = err;
  for (let i = 0; i < maxDepth && cur != null; i++) {
    out.push(cur);
    if (cur instanceof Error && "cause" in cur && cur.cause !== void 0) {
      cur = cur.cause;
    } else {
      break;
    }
  }
  return out;
}
function errnoFromNodeError(e) {
  if (typeof e === "object" && e !== null && "code" in e) {
    const c = e.code;
    return typeof c === "string" ? c : void 0;
  }
  return void 0;
}
function transportHintForErrno(code) {
  switch (code) {
    case "ECONNREFUSED":
      return "Connection refused \u2014 nothing is listening on that host/port (is the webhook infra server running?).";
    case "ENOTFOUND":
      return "Host not found \u2014 check the endpoint hostname/DNS.";
    case "ECONNRESET":
      return "Connection was reset by the peer.";
    case "ETIMEDOUT":
    case "ESOCKETTIMEDOUT":
      return "Socket timed out before a response \u2014 the server may be overloaded or unreachable.";
    case "CERT_HAS_EXPIRED":
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
      return "TLS/certificate problem when connecting to the endpoint.";
    default:
      return "";
  }
}
function isAbortError(err) {
  return err instanceof DOMException && err.name === "AbortError" || err instanceof Error && err.name === "AbortError";
}
function formatTransportFailureMessage(base, requestUrl, path, timeoutMs, err) {
  const causes = flattenErrorCauses(err);
  let errno;
  for (const c of causes) {
    const code = errnoFromNodeError(c);
    if (code) {
      errno = code;
      break;
    }
  }
  let summary;
  if (causes.some(isAbortError)) {
    summary = `Request was aborted \u2014 usually a timeout after ${timeoutMs}ms or an explicit cancel.`;
  } else {
    const hint = transportHintForErrno(errno);
    summary = hint || "The client could not complete the HTTP request (network or runtime error).";
  }
  const root = causes[0];
  const underlying = root instanceof Error ? root.stack ? root.stack.split("\n").slice(0, 3).join("\n") : root.message : String(root);
  const lines = [
    "Webhook infra unreachable \u2014 there was no HTTP response from the server.",
    "",
    `  Configured endpoint: ${base}`,
    `  Request:             POST ${path}`,
    `  Full URL:            ${requestUrl}`,
    "",
    `  What went wrong: ${summary}`
  ];
  if (errno) {
    lines.push(`  System code:     ${errno}`);
  }
  lines.push("", "  Technical detail (first lines):");
  for (const line of underlying.split("\n")) {
    lines.push(`    ${line}`);
  }
  return lines.join("\n");
}
function transportFailure(base, requestUrl, path, timeoutMs, err) {
  const message = formatTransportFailureMessage(base, requestUrl, path, timeoutMs, err);
  return new WebhookLibError(message, 0, null, true);
}
function errorDetail(body, fallback) {
  if (typeof body === "object" && body !== null && "error" in body) {
    return String(body.error);
  }
  return fallback;
}
function createWebhooks(options) {
  const base = normalizeBase(options.endpoint);
  const key = options.key;
  if (!key) {
    throw new Error("createWebhooks: key is required");
  }
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 3e4;
  const maxEmitAttempts = Math.max(1, options.maxEmitAttempts ?? 3);
  async function post(path, json) {
    const url = new URL(path.startsWith("/") ? path : `/${path}`, `${base}/`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let res;
      try {
        res = await fetchImpl(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": key
          },
          body: JSON.stringify(json),
          signal: controller.signal
        });
      } catch (err) {
        throw transportFailure(base, url.href, path, timeoutMs, err);
      }
      let text;
      try {
        text = await res.text();
      } catch (err) {
        throw transportFailure(base, url.href, path, timeoutMs, err);
      }
      let body;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = { raw: text };
      }
      return { status: res.status, body };
    } finally {
      clearTimeout(timer);
    }
  }
  function fail(status, body, prefix) {
    const detail = errorDetail(body, typeof body === "string" ? body : JSON.stringify(body));
    const lines = [
      `${prefix} (${status})`,
      "",
      `  Detail: ${detail}`
    ];
    throw new WebhookLibError(lines.join("\n"), status, body);
  }
  return {
    async register(event, subscriberUrl) {
      const { status, body } = await post("/api/subscribe", { event, subscriber: subscriberUrl });
      if (status !== 201) {
        fail(status, body, "register failed");
      }
      return body;
    },
    async emit(event, msg) {
      let lastErr;
      for (let attempt = 0; attempt < maxEmitAttempts; attempt++) {
        try {
          const { status, body } = await post("/api/omit", { event, msg });
          if (status >= 200 && status < 300) {
            return body;
          }
          if (isRetryableEmitStatus(status) && attempt < maxEmitAttempts - 1) {
            await delay(100 * 2 ** attempt);
            continue;
          }
          fail(status, body, "emit failed");
        } catch (err) {
          lastErr = err;
          if (err instanceof WebhookLibError) {
            if (err.transportFailure && attempt < maxEmitAttempts - 1) {
              await delay(100 * 2 ** attempt);
              continue;
            }
            throw err;
          }
          if (isRetryableFetchError(err) && attempt < maxEmitAttempts - 1) {
            await delay(100 * 2 ** attempt);
            continue;
          }
          throw err;
        }
      }
      throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
    }
  };
}
var WebhookProcessor = class {
  #options;
  constructor(options) {
    this.#options = { ...options };
  }
  /**
   * Handles a decoded webhook payload for the given event.
   *
   * @param event - Logical event name (for example, `order.created`).
   * @param body - Parsed JSON body or structured payload.
   */
  async process(event, body) {
    void this.#options;
  }
};
function validateSignature(payload, signature, secret, _algorithm = "sha256") {
  return false;
}

export { WebhookLibError, WebhookProcessor, createWebhooks, validateSignature };
//# sourceMappingURL=index.mjs.map
//# sourceMappingURL=index.mjs.map