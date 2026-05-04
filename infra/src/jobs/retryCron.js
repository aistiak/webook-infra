const cron = require('node-cron');
const Retry = require('../models/Retry');
const { postToSubscriber } = require('../services/deliverWebhook');

/** After emit failure: wait 3s. After each failed cron attempt: 5s, then 8s, then DLQ. */
const CRON_BACKOFF_MS = [5000, 8000];

async function processOneRetry(doc) {
  const body = { event: doc.event, msg: doc.payload };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    await postToSubscriber(doc.subscriberUrl, body, controller.signal);
    doc.status = 'success';
    await doc.save();
  } catch {
    if (doc.retryCount >= 2) {
      doc.status = 'dlq';
      await doc.save();
      return;
    }
    doc.retryCount = doc.retryCount + 1;
    const delay = CRON_BACKOFF_MS[doc.retryCount - 1];
    doc.nextRetryAt = new Date(Date.now() + delay);
    await doc.save();
  } finally {
    clearTimeout(timeout);
  }
}

function startRetryCron() {
  cron.schedule('*/1 * * * * *', async () => {
    const now = new Date();
    const due = await Retry.find({
      status: 'fail',
      nextRetryAt: { $lte: now },
    })
      .limit(50)
      .exec();

    for (const doc of due) {
      try {
        await processOneRetry(doc);
      } catch {
        // leave doc for next tick or manual inspection
      }
    }
  });
}

module.exports = { startRetryCron, processOneRetry };
