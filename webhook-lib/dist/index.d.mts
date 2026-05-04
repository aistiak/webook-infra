/**
 * Configuration for {@link createWebhooks}.
 */
interface CreateWebhooksOptions {
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
interface RegisterSubscriberResult {
    readonly id: string;
    readonly accountId: string;
    readonly event: string;
    readonly subscriberUrl: string;
}
/** Result of {@link Webhooks.emit} (`POST /api/omit`). */
interface EmitEventResult {
    readonly ok: boolean;
    readonly deliveredTo: number;
}
/**
 * Client returned by {@link createWebhooks} for registering subscribers and emitting events.
 */
interface Webhooks {
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
declare class WebhookLibError extends Error {
    readonly status: number;
    readonly body: unknown;
    /** True when the request never completed (network, refused connection, timeout, etc.). */
    readonly transportFailure: boolean;
    constructor(message: string, status: number, body: unknown, transportFailure?: boolean);
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
declare function createWebhooks(options: CreateWebhooksOptions): Webhooks;
/**
 * Optional configuration for {@link WebhookProcessor}.
 */
interface WebhookProcessorOptions {
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
declare class WebhookProcessor {
    #private;
    constructor(options?: WebhookProcessorOptions);
    /**
     * Handles a decoded webhook payload for the given event.
     *
     * @param event - Logical event name (for example, `order.created`).
     * @param body - Parsed JSON body or structured payload.
     */
    process(event: string, body: unknown): Promise<void>;
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
declare function validateSignature(payload: string | Uint8Array, signature: string, secret: string, _algorithm?: string): boolean;

export { type CreateWebhooksOptions, type EmitEventResult, type RegisterSubscriberResult, WebhookLibError, WebhookProcessor, type WebhookProcessorOptions, type Webhooks, createWebhooks, validateSignature };
