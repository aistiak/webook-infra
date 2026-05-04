/**
 * Configuration for {@link createWebhooks}.
 */
export interface CreateWebhooksOptions {
  /** Base URL of the webhook API (e.g. `https://relay.example.com` or `http://127.0.0.1:3000`). */
  readonly endpoint: string;
  /** Account API key (sent as `x-api-key`). */
  readonly key: string;
  /**
   * Maximum HTTP attempts for {@link Webhooks.emit} on retryable failures
   * (5xx, 408, 429, network errors). Defaults to `3`. Not used for {@link Webhooks.register}.
   */
  readonly maxEmitAttempts?: number;
  /** Per-request timeout in ms. Defaults to `30_000`. */
  readonly timeoutMs?: number;
  /** Override `fetch` (tests or custom agents). */
  readonly fetch?: typeof fetch;
}

/** Result of {@link Webhooks.register} (`POST /api/subscribe`). */
export interface RegisterSubscriberResult {
  readonly id: string;
  readonly accountId: string;
  readonly event: string;
  readonly subscriberUrl: string;
}

/** Result of {@link Webhooks.emit} (`POST /api/omit`). */
export interface EmitEventResult {
  readonly ok: boolean;
  readonly deliveredTo: number;
}

/**
 * Client returned by {@link createWebhooks} for registering subscribers and emitting events.
 */
export interface Webhooks {
  /**
   * Registers a subscriber URL for an event (idempotent from the server’s perspective:
   * each call may create a new subscription row).
   */
  register(event: string, subscriberUrl: string): Promise<RegisterSubscriberResult>;

  /**
   * Delivers a payload to all subscribers registered for `event` for this account.
   * Retries on transient HTTP failures and network errors.
   */
  emit(event: string, msg: unknown): Promise<EmitEventResult>;
}

export class WebhookLibError extends Error {
  readonly status: number;
  readonly body: unknown;
  /** True when the request never completed (network, refused connection, timeout, etc.). */
  readonly transportFailure: boolean;

  constructor(message: string, status: number, body: unknown, transportFailure = false) {
    super(message);
    this.name = 'WebhookLibError';
    this.status = status;
    this.body = body;
    this.transportFailure = transportFailure;
  }
}

function normalizeBase(endpoint: string): string {
  const s = endpoint.trim();
  if (!s) {
    throw new Error('createWebhooks: endpoint is required');
  }
  return s.replace(/\/+$/, '');
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryableEmitStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function isRetryableFetchError(err: unknown): boolean {
  if (err instanceof WebhookLibError) return false;
  if (err instanceof TypeError) return true;
  if (err instanceof DOMException && err.name === 'AbortError') return false;
  if (err instanceof Error && err.name === 'AbortError') return false;
  return false;
}

function flattenErrorCauses(err: unknown, maxDepth = 8): unknown[] {
  const out: unknown[] = [];
  let cur: unknown = err;
  for (let i = 0; i < maxDepth && cur != null; i++) {
    out.push(cur);
    if (cur instanceof Error && 'cause' in cur && (cur as Error & { cause?: unknown }).cause !== undefined) {
      cur = (cur as Error & { cause?: unknown }).cause;
    } else {
      break;
    }
  }
  return out;
}

function errnoFromNodeError(e: unknown): string | undefined {
  if (typeof e === 'object' && e !== null && 'code' in e) {
    const c = (e as { code?: unknown }).code;
    return typeof c === 'string' ? c : undefined;
  }
  return undefined;
}

function transportHintForErrno(code: string | undefined): string {
  switch (code) {
    case 'ECONNREFUSED':
      return 'Connection refused — nothing is listening on that host/port (is the webhook infra server running?).';
    case 'ENOTFOUND':
      return 'Host not found — check the endpoint hostname/DNS.';
    case 'ECONNRESET':
      return 'Connection was reset by the peer.';
    case 'ETIMEDOUT':
    case 'ESOCKETTIMEDOUT':
      return 'Socket timed out before a response — the server may be overloaded or unreachable.';
    case 'CERT_HAS_EXPIRED':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
      return 'TLS/certificate problem when connecting to the endpoint.';
    default:
      return '';
  }
}

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === 'AbortError') ||
    (err instanceof Error && err.name === 'AbortError')
  );
}

function formatTransportFailureMessage(
  base: string,
  requestUrl: string,
  path: string,
  timeoutMs: number,
  err: unknown,
): string {
  const causes = flattenErrorCauses(err);
  let errno: string | undefined;
  for (const c of causes) {
    const code = errnoFromNodeError(c);
    if (code) {
      errno = code;
      break;
    }
  }

  let summary: string;
  if (causes.some(isAbortError)) {
    summary = `Request was aborted — usually a timeout after ${timeoutMs}ms or an explicit cancel.`;
  } else {
    const hint = transportHintForErrno(errno);
    summary = hint || 'The client could not complete the HTTP request (network or runtime error).';
  }

  const root = causes[0];
  const underlying =
    root instanceof Error
      ? root.stack
        ? root.stack.split('\n').slice(0, 3).join('\n')
        : root.message
      : String(root);

  const lines = [
    'Webhook infra unreachable — there was no HTTP response from the server.',
    '',
    `  Configured endpoint: ${base}`,
    `  Request:             POST ${path}`,
    `  Full URL:            ${requestUrl}`,
    '',
    `  What went wrong: ${summary}`,
  ];
  if (errno) {
    lines.push(`  System code:     ${errno}`);
  }
  lines.push('', '  Technical detail (first lines):');
  for (const line of underlying.split('\n')) {
    lines.push(`    ${line}`);
  }
  return lines.join('\n');
}

function transportFailure(base: string, requestUrl: string, path: string, timeoutMs: number, err: unknown): WebhookLibError {
  const message = formatTransportFailureMessage(base, requestUrl, path, timeoutMs, err);
  return new WebhookLibError(message, 0, null, true);
}

function errorDetail(body: unknown, fallback: string): string {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    return String((body as { error?: unknown }).error);
  }
  return fallback;
}

/**
 * Builds a webhook client for registering subscriber URLs and emitting events
 * to your webhook relay (webhook-infra–compatible API).
 *
 * @example
 * ```ts
 * const webhooks = createWebhooks({ endpoint: 'https://api.example.com', key: process.env.WEBHOOK_KEY! });
 * await webhooks.register('order.created', 'https://example.com/hook');
 * await webhooks.emit('order.created', { orderId: '42' });
 * ```
 */
export function createWebhooks(options: CreateWebhooksOptions): Webhooks {
  const base = normalizeBase(options.endpoint);
  const key = options.key;
  if (!key) {
    throw new Error('createWebhooks: key is required');
  }

  const fetchImpl = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxEmitAttempts = Math.max(1, options.maxEmitAttempts ?? 3);

  async function post(path: string, json: unknown): Promise<{ status: number; body: unknown }> {
    const url = new URL(path.startsWith('/') ? path : `/${path}`, `${base}/`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let res: Response;
      try {
        res = await fetchImpl(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': key,
          },
          body: JSON.stringify(json),
          signal: controller.signal,
        });
      } catch (err) {
        throw transportFailure(base, url.href, path, timeoutMs, err);
      }

      let text: string;
      try {
        text = await res.text();
      } catch (err) {
        throw transportFailure(base, url.href, path, timeoutMs, err);
      }

      let body: unknown;
      try {
        body = text ? (JSON.parse(text) as unknown) : null;
      } catch {
        body = { raw: text };
      }
      return { status: res.status, body };
    } finally {
      clearTimeout(timer);
    }
  }

  function fail(status: number, body: unknown, prefix: string): never {
    const detail = errorDetail(body, typeof body === 'string' ? body : JSON.stringify(body));
    const lines = [
      `${prefix} (${status})`,
      '',
      `  Detail: ${detail}`,
    ];
    throw new WebhookLibError(lines.join('\n'), status, body);
  }

  return {
    async register(event: string, subscriberUrl: string): Promise<RegisterSubscriberResult> {
      const { status, body } = await post('/api/subscribe', { event, subscriber: subscriberUrl });
      if (status !== 201) {
        fail(status, body, 'register failed');
      }
      return body as RegisterSubscriberResult;
    },

    async emit(event: string, msg: unknown): Promise<EmitEventResult> {
      let lastErr: unknown;
      for (let attempt = 0; attempt < maxEmitAttempts; attempt++) {
        try {
          const { status, body } = await post('/api/omit', { event, msg });
          if (status >= 200 && status < 300) {
            return body as EmitEventResult;
          }
          if (isRetryableEmitStatus(status) && attempt < maxEmitAttempts - 1) {
            await delay(100 * 2 ** attempt);
            continue;
          }
          fail(status, body, 'emit failed');
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
    },
  };
}

/**
 * Optional configuration for {@link WebhookProcessor}.
 */
export interface WebhookProcessorOptions {
  /**
   * Human-readable name for logging, metrics, or debugging.
   */
  readonly name?: string;
}

/**
 * Coordinates webhook receipt, validation, and downstream handling.
 *
 * This is a **placeholder** implementation: extend or replace `process`
 * with your routing, persistence, and retry logic.
 *
 * @example
 * ```ts
 * const processor = new WebhookProcessor({ name: 'orders' });
 * await processor.process('order.created', { orderId: '42' });
 * ```
 */
export class WebhookProcessor {
  readonly #options: Readonly<WebhookProcessorOptions>;

  constructor(options?: WebhookProcessorOptions) {
    this.#options = { ...options };
  }

  /**
   * Handles a decoded webhook payload for the given event.
   *
   * @param event - Logical event name (for example, `order.created`).
   * @param body - Parsed JSON body or structured payload.
   */
  async process(event: string, body: unknown): Promise<void> {
    void event;
    void body;
    void this.#options;
    // Placeholder: wire signature checks, idempotency, queues, etc.
  }
}

/**
 * Validates a webhook signature against a shared secret.
 *
 * **Placeholder:** always returns `false`. Replace with a constant-time
 * comparison of an HMAC (or provider-specific scheme) before trusting payloads.
 *
 * @param payload - Raw request body bytes or UTF-8 string.
 * @param signature - Signature header value from the HTTP request.
 * @param secret - Shared signing secret.
 * @param _algorithm - Optional algorithm label (for example, `sha256`).
 * @returns `true` if the signature is valid; currently always `false`.
 *
 * @example
 * ```ts
 * const ok = validateSignature(rawBody, req.headers['x-signature'] ?? '', process.env.WEBHOOK_SECRET!);
 * ```
 */
export function validateSignature(
  payload: string | Uint8Array,
  signature: string,
  secret: string,
  _algorithm = 'sha256',
): boolean {
  void payload;
  void signature;
  void secret;
  return false;
}
