const db = require('../connection');

const { Schema } = db;

const SlackToken = new Schema(
  {
    teamName: { type: String, required: true },
    teamId: { type: String, required: true },
    appToken: { type: String, required: true },
    botToken: { type: String, required: true },
  },
);

// Export model
module.exports = db.model('SlackTokens', SlackToken);
