const mongoose = require('mongoose');

const accountSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true },
    apiKey: { type: String, required: true, unique: true, index: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Account', accountSchema);
