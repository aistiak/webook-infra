require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const { connectDb } = require('./db');
const Account = require('./models/Account');
const Subscriber = require('./models/Subscriber');
const { requireApiKey } = require('./middleware/apiKey');
const { deliverEventToTargets } = require('./services/deliverWebhook');
const { startRetryCron } = require('./jobs/retryCron');

const PORT = Number(process.env.PORT) || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/webhooks';

function isHttpUrl(s) {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

async function main() {
  await connectDb(MONGO_URI);

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.post('/api/account', async (req, res) => {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    if (!username) {
      return res.status(400).json({ error: 'username is required' });
    }

    try {
      const apiKey = crypto.randomBytes(32).toString('hex');
      const account = await Account.create({ username, apiKey });
      return res.status(201).json({ username: account.username, apiKey: account.apiKey });
    } catch (err) {
      if (err && err.code === 11000) {
        return res.status(409).json({ error: 'username must be unique' });
      }
      return res.status(500).json({ error: 'could not create account' });
    }
  });

  app.post('/api/subscribe', requireApiKey, async (req, res) => {
    const event = typeof req.body?.event === 'string' ? req.body.event.trim() : '';
    const subscriber = req.body?.subscriber;
    const subscriberUrl =
      typeof subscriber === 'string' ? subscriber.trim() : typeof subscriber === 'object' && subscriber?.url ? String(subscriber.url).trim() : '';

    if (!event || !subscriberUrl) {
      return res.status(400).json({ error: 'event and subscriber (URL string) are required' });
    }
    if (!isHttpUrl(subscriberUrl)) {
      return res.status(400).json({ error: 'subscriber must be a valid http(s) URL' });
    }

    const sub = await Subscriber.create({
      accountId: req.account._id,
      event,
      subscriberUrl,
    });
    return res.status(201).json({
      id: sub._id,
      accountId: sub.accountId,
      event: sub.event,
      subscriberUrl: sub.subscriberUrl,
    });
  });

  app.post('/api/omit', requireApiKey, async (req, res) => {
    const event = typeof req.body?.event === 'string' ? req.body.event.trim() : '';
    const msg = req.body?.msg;

    if (!event) {
      return res.status(400).json({ error: 'event is required' });
    }
    if (msg === undefined) {
      return res.status(400).json({ error: 'msg is required (JSON)' });
    }

    const targets = await Subscriber.find({
      accountId: req.account._id,
      event,
    })
      .select('subscriberUrl')
      .lean();

    await deliverEventToTargets(req.account._id, event, msg, targets);

    return res.json({
      ok: true,
      deliveredTo: targets.length,
    });
  });

  startRetryCron();

  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`webhook-infra listening on :${PORT}`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
