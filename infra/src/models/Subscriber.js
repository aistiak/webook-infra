const mongoose = require('mongoose');

const subscriberSchema = new mongoose.Schema(
  {
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    event: { type: String, required: true, trim: true },
    subscriberUrl: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

subscriberSchema.index({ accountId: 1, event: 1 });

module.exports = mongoose.model('Subscriber', subscriberSchema);
