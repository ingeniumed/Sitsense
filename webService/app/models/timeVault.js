const db = require('../connection');

const { Schema } = db;

const TimeVault = new Schema(
  {
    email: { type: String, required: true },
    teamId: { type: String, required: true },
    userId: { type: String, required: true },
    dailyTimes: { type: Array, required: true },
    weekNumber: { type: Number, required: true },
    dayNumber: { type: Number, required: true },
  },
);

// Export model
module.exports = db.model('TimeVaults', TimeVault);
