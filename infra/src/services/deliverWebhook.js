const Retry = require('../models/Retry');

const BACKOFF_MS = [3000, 5000, 8000];

function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) {
    out.push(array.slice(i, i + size));
  }
  return out;
}

async function postToSubscriber(subscriberUrl, body, signal) {
  const res = await fetch(subscriberUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
}

/**
 * @param {import('mongoose').Types.ObjectId} accountId
 * @param {string} event
 * @param {unknown} msg
 * @param {{ subscriberUrl: string }[]} targets
 */
async function deliverEventToTargets(accountId, event, msg, targets) {
  const body = { event, msg };
  const batches = chunk(targets, 5);

  for (const batch of batches) {
    await Promise.all(
      batch.map(async ({ subscriberUrl }) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 25_000);
        try {
          await postToSubscriber(subscriberUrl, body, controller.signal);
        } catch {
          await Retry.create({
            accountId,
            event,
            subscriberUrl,
            payload: msg,
            retryCount: 0,
            nextRetryAt: new Date(Date.now() + BACKOFF_MS[0]),
            status: 'fail',
          });
        } finally {
          clearTimeout(timeout);
        }
      })
    );
  }
}

module.exports = { deliverEventToTargets, postToSubscriber, BACKOFF_MS };
