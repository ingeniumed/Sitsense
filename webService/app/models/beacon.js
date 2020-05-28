const db = require('../connection');

const { Schema } = db;

const Beacon = new Schema(
  {
    imageId: { type: String, required: true },
    deviceId: { type: String, index: { unique: true }, required: true },
    rssi: { type: Number },
    userId: { type: String, required: true },
    email: { type: String, required: true },
    teamId: { type: String, required: true },
    appToken: { type: String, required: true },
    botToken: { type: String, required: true },
    accel: { type: Number, required: true },
    accelX: { type: Number, required: true },
    accelY: { type: Number, required: true },
    accelZ: { type: Number, required: true },
    notifyCount: { type: Number, required: true },
    moveCount: { type: Number, required: true },
    avgSitTime: { type: Number, required: true },
    goalSitTime: { type: Number, required: true },
    sitTime: { type: Number, required: true },
    dailySitTime: { type: Number, required: true },
    monday: { type: Number, required: true },
    tuesday: { type: Number, required: true },
    wednesday: { type: Number, required: true },
    thursday: { type: Number, required: true },
    friday: { type: Number, required: true },
    prevWeekSitTime: { type: Number, required: true },
    prevPrevWeekSitTime: { type: Number, required: true },
    firstDayNotify: { type: Boolean, required: true },
    lastNotification: { type: Number, required: true },
    updatedAt: { type: Number, default: new Date().getTime() },
    dailyTimes: { type: Array, required: true },
  },
);

// Export model
module.exports = db.model('Beacons', Beacon);
