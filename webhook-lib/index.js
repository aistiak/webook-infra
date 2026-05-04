/**
 * @param {{ baseUrl: string, apiKey: string }} opts
 */
function createWebhooks(opts) {
  const baseUrl = opts.baseUrl.replace(/\/$/, '');
  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': opts.apiKey,
  };

  return {
    async register(event, subscriber) {
      const subscriberPayload =
        typeof subscriber === 'string' ? subscriber : subscriber?.url ?? subscriber;
      const res = await fetch(`${baseUrl}/api/subscribe`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ event, subscriber: subscriberPayload }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `subscribe failed: ${res.status}`);
      }
      return res.json();
    },

    async emit(event, msg) {
      const res = await fetch(`${baseUrl}/api/omit`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ event, msg }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `emit failed: ${res.status}`);
      }
      return res.json();
    },
  };
}

module.exports = { createWebhooks };
