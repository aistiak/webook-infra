require('dotenv').config();
const { createWebhooks } = require('webhook-lib');

async function main() {
  const endpoint = process.env.WEBHOOK_BASE_URL;
  const key = process.env.WEBHOOK_API_KEY;
  if (!key) {
    console.error('Missing WEBHOOK_API_KEY (create an account via POST /api/account, then set the key).');
    process.exit(1);
  }

  const webhooks = createWebhooks({ endpoint, key });

  const event = "msg.delivered";
  const subscriberUrl = process.env.URL;

  if (subscriberUrl) {
    const sub = await webhooks.register(event, subscriberUrl);
    console.log('Registered:', sub);
  }

  const result = await webhooks.emit(event, {
    source: 'demo-app',
    at: new Date().toISOString(),
    note: process.env.WEBHOOK_MSG_NOTE || 'hello from demo-app',
  });
  console.log('Emitted:', result);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
