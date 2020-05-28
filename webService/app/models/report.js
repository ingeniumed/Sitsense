const db = require('../connection');

const { Schema } = db;

const Report = new Schema(
  {
    email: { type: String, required: true },
    teamId: { type: String, required: true },
    weeklySitTime: { type: String, required: true },
    dailyAverage: { type: Number, required: true },
    weekNumber: { type: Number, required: true },
  },
);

// Export model
module.exports = db.model('Reports', Report);
