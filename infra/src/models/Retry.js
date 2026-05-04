const mongoose = require('mongoose');

/** @typedef {'fail'|'success'|'dlq'} RetryStatus */

const retrySchema = new mongoose.Schema(
  {
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    event: { type: String, required: true, trim: true },
    subscriberUrl: { type: String, required: true, trim: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    retryCount: { type: Number, required: true, default: 0 },
    nextRetryAt: { type: Date, required: true, index: true },
    status: {
      type: String,
      enum: ['fail', 'success', 'dlq'],
      required: true,
      default: 'fail',
      index: true,
    },
  },
  { timestamps: true }
);

retrySchema.index({ status: 1, nextRetryAt: 1 });

module.exports = mongoose.model('Retry', retrySchema);
