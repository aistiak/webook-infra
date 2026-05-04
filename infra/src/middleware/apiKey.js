const Account = require('../models/Account');

async function requireApiKey(req, res, next) {
  const key =
    req.header('x-api-key') ||
    (req.header('authorization') || '').replace(/^Bearer\s+/i, '').trim();

  if (!key) {
    return res.status(401).json({ error: 'Missing API key (x-api-key or Authorization: Bearer)' });
  }

  const account = await Account.findOne({ apiKey: key });
  if (!account) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  req.account = account;
  return next();
}

module.exports = { requireApiKey };
