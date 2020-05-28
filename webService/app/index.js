const socketioClient = require('socket.io-client');
const request = require('request');
const moment = require('moment-timezone');
const uuidv4 = require('uuid/v4');
const Beacon = require('./models/beacon');
const Report = require('./models/report');
const TimeVault = require('./models/timeVault');
const SlackToken = require('./models/slackToken');
const utilities = require('./utility.js');
const vegaFcns = require('./vegaspec.js');

moment.tz.setDefault('America/Toronto');
const socket = socketioClient(process.env.SERVER_URL, { query: { token: process.env.PARETO_TOKEN } });
const logger = utilities.getWinston();

function createBeaconModel(event, tags, workHourDetails) {
  const beaconData = new Beacon();
  beaconData.imageId = uuidv4();
  beaconData.monday = 0;
  beaconData.tuesday = 0;
  beaconData.wednesday = 0;
  beaconData.thursday = 0;
  beaconData.friday = 0;
  beaconData.deviceId = event.deviceId;
  beaconData.rssi = event.rssi;
  beaconData.teamId = tags.teamId;
  beaconData.email = tags.email;
  beaconData.accelX = Math.abs(event.tiraid.identifier.advData.serviceData.minew.accelerationX);
  beaconData.accelY = Math.abs(event.tiraid.identifier.advData.serviceData.minew.accelerationY);
  beaconData.accelZ = Math.abs(event.tiraid.identifier.advData.serviceData.minew.accelerationZ);
  beaconData.accel = utilities.getAcceleration(beaconData.accelX, beaconData.accelY, beaconData.accelZ);
  beaconData.sitTime = 0;
  beaconData.dailySitTime = 0;
  beaconData.notifyCount = 0;
  beaconData.updatedAt = workHourDetails.currentTime;
  beaconData.lastNotification = workHourDetails.currentTime;
  beaconData.moveCount = 0;
  beaconData.firstDayNotify = false;
  beaconData.prevPrevWeekSitTime = 0;
  beaconData.prevWeekSitTime = 0;
  beaconData.dailyTimes = [];
  beaconData.avgSitTime = 0;
  beaconData.goalSitTime = 0;
  return beaconData;
}

function createUserReport(result) {
  const userReport = new Report();
  userReport.teamId = result.teamId;
  userReport.weekNumber = moment().week();
  userReport.email = result.email;
  userReport.weeklySitTime = utilities.convertSecondsToTime(result.prevWeekSitTime);
  userReport.dailyAverage = result.prevWeekSitTime / 5;
  return userReport;
}

function createTimeVault(result) {
  const timeVault = new TimeVault();
  timeVault.userId = result.userId;
  timeVault.teamId = result.teamId;
  timeVault.weekNumber = moment().week();
  timeVault.dayNumber = moment().day();
  timeVault.email = result.email;
  timeVault.dailyTimes = result.dailyTimes;
  return timeVault;
}

function updateBeacon(result, event) {
  Beacon.updateOne({ deviceId: event.deviceId }, {
    $set: {
      avgSitTime: result.avgSitTime,
      goalSitTime: result.goalSitTime,
      dailyTimes: result.dailyTimes,
      imageId: result.imageId,
      monday: result.monday,
      tuesday: result.tuesday,
      wednesday: result.wednesday,
      thursday: result.thursday,
      friday: result.friday,
      rssi: result.rssi,
      accel: result.accel,
      accelX: result.accelX,
      accelY: result.accelY,
      accelZ: result.accelZ,
      updatedAt: result.updatedAt,
      lastNotification: result.lastNotification,
      moveCount: result.moveCount,
      notifyCount: result.notifyCount,
      sitTime: result.sitTime,
      dailySitTime: result.dailySitTime,
      prevPrevWeekSitTime: result.prevPrevWeekSitTime,
      prevWeekSitTime: result.prevWeekSitTime,
      firstDayNotify: result.firstDayNotify,
    },
  }, { upset: false }, (err) => {
    if (err) throw err;
    utilities.logData(logger, 'Updated beacon');
  });
}

function saveReport(userReport) {
  userReport.save((err) => {
    if (err) throw err;
    utilities.logData(logger, 'Created user report for this week');
  });
}

function saveTimeVault(timeVault) {
  timeVault.save((err) => {
    if (err) throw err;
    utilities.logData(logger, 'Time vault has been updated with the precious daily times for today, err yesterday');
  });
}

function updateDayOfWeekSitTime(result, workHourDetails) {
  if (workHourDetails.dayOfWeek === 1) {
    result.friday = result.sitTime;
  } else if (workHourDetails.dayOfWeek === 2) {
    result.monday = result.sitTime;
  } else if (workHourDetails.dayOfWeek === 3) {
    result.tuesday = result.sitTime;
  } else if (workHourDetails.dayOfWeek === 4) {
    result.wednesday = result.sitTime;
  } else if (workHourDetails.dayOfWeek === 5) {
    result.thursday = result.sitTime;
  }

  return result;
}

function shouldNotificationOccur(result, currentTime) {
  const timeDiff = Math.abs(result.lastNotification - currentTime);
  const sitTimeRatio = result.sitTime / timeDiff;
  if (timeDiff < result.sitTime || sitTimeRatio < 0.75) {
    utilities.logData(logger, `Sit time wasn't hit in the right time ratio: ${sitTimeRatio}`);
  } else if (sitTimeRatio >= 0.75) {
    utilities.logData(logger, `Sit time was hit in the right time ratio: ${sitTimeRatio}`);
    const slackMsg = utilities.getContinousWarning();
    utilities.notifySlackUser(result.botToken, slackMsg, result.userId);
  }
}

function trackContinousSitTime(result, currentTime) {
  if (Math.abs(result.sitTime - result.notifyCount) >= 3600) {
    shouldNotificationOccur(result, currentTime);
    result.lastNotification = currentTime;
    result.notifyCount = result.sitTime;
    utilities.logData(logger, 'Hit the 60 min mark for sit time');
  } else {
    utilities.logData(logger, `No continous sit time yet to record ${result.notifyCount}`);
  }

  return result;
}

function updateMoveCount(moveCount, isOccupied) {
  if (isOccupied) {
    return (moveCount === utilities.MAX_MOVEMENT_COUNT) ? moveCount : moveCount + 1;
  }
  return (moveCount < 1) ? 0 : moveCount - 1;
}

function resetBeacon(result, workHourDetails, accel, accelerationX, accelerationY, accelerationZ) {
  const timeVault = createTimeVault(result);
  saveTimeVault(timeVault);
  result = updateDayOfWeekSitTime(result, workHourDetails);
  if (result.avgSitTime) {
    result.avgSitTime = (result.avgSitTime + result.sitTime) / 2;
  } else {
    result.avgSitTime = result.sitTime;
  }
  utilities.logData(logger, `Updated new average sit time to be ${result.avgSitTime}`);
  if ((result.goalSitTime && result.avgSitTime < result.goalSitTime) || (!result.goalSitTime)) {
    utilities.logData(logger, `Updated new goal sit time to be ${result.goalSitTime}`);
    result.goalSitTime = result.avgSitTime;
  }

  result.moveCount = 0;
  result.sitTime = 0;
  result.notifyCount = 0;
  result.lastNotification = workHourDetails.currentTime;
  result.updatedAt = workHourDetails.currentTime;
  result.accel = accel;
  result.accelX = accelerationX;
  result.accelY = accelerationY;
  result.accelZ = accelerationZ;
  result.dailyTimes = [];

  if (!result.imageId) {
    result.imageId = uuidv4();
  }

  return result;
}

function getDailyTime(moveCount, sitTime, currentTime) {
  return {
    time: currentTime,
    sit: sitTime,
    movements: moveCount,
  };
}

function trackContinousDailyTime(result, currentTime) {
  if (result.dailyTimes && result.dailyTimes.length === 0) {
    utilities.logData(logger, `Instantiated new daily sit time at ${currentTime} for ${result.sitTime}s`);
    result.dailyTimes.push(getDailyTime(result.moveCount, result.sitTime, currentTime));
  } else {
    const latestDailyTime = result.dailyTimes[result.dailyTimes.length - 1];
    const timeDiff = Math.abs(currentTime - (latestDailyTime.time));
    if (timeDiff >= 3600) {
      utilities.logData(logger, `Updated new daily sit time at ${currentTime} for ${result.sitTime}s`);
      result.dailyTimes.push(getDailyTime(result.moveCount, result.sitTime, currentTime));
    }
  }

  return result;
}

function computeDiffAndNotify(workHourDetails, result, event) {
  let userReport;

  // times
  const timeDiff = (workHourDetails.currentTime - result.updatedAt);

  // accelerations
  const accelerationX = Math.abs(event.tiraid.identifier.advData.serviceData.minew.accelerationX);
  const accelerationY = Math.abs(event.tiraid.identifier.advData.serviceData.minew.accelerationY);
  const accelerationZ = Math.abs(event.tiraid.identifier.advData.serviceData.minew.accelerationZ);
  const accel = utilities.getAcceleration(accelerationX, accelerationY, accelerationZ);

  // update the rssi values
  result.rssi = event.rssi;

  const accelDiff = Math.abs(Math.abs(result.accel) - Math.abs(accel));

  // Flags
  let skipFirstRunFlag = false;
  let updateBeaconFlag = false;
  let createReportFlag = false;

  utilities.logData(logger, `New movement detected for device: ${result.deviceId}`);
  utilities.logData(logger, `Total acceleration: ${accel}, Acceleration X: ${accelerationX}, Acceleration Y: ${accelerationY}, Acceleration Z: ${accelerationZ}`);

  if (utilities.isItMonday(workHourDetails, result)) {
    utilities.logData(logger, 'Reseting data for monday');
    result.firstDayNotify = false;
    result.prevPrevWeekSitTime = result.prevWeekSitTime;
    result.prevWeekSitTime = result.dailySitTime + result.sitTime;
    result = resetBeacon(result, workHourDetails, accel, accelerationX, accelerationY, accelerationZ);
    result.dailySitTime = 0;
    userReport = createUserReport(result);
    updateBeaconFlag = true;
    createReportFlag = true;
    skipFirstRunFlag = true;
    vegaFcns.saveWeeklyReport(result, workHourDetails);
    utilities.logData(logger, `Week ended with prev week sit time: ${result.prevWeekSitTime} and prev prev week sit time: ${result.prevPrevWeekSitTime}`);
  } else if (utilities.isDayToBeReset(result.updatedAt, workHourDetails.currentTime, workHourDetails)) {
    utilities.logData(logger, 'Reseting data for a weekday besides monday');
    result.firstDayNotify = true;
    result.dailySitTime += result.sitTime;
    vegaFcns.saveDailyReport(result, logger, workHourDetails);
    result = resetBeacon(result, workHourDetails, accel, accelerationX, accelerationY, accelerationZ);
    updateBeaconFlag = true;
    skipFirstRunFlag = true;
    utilities.logData(logger, `Prev day ended with daily sit time: ${result.dailySitTime}`);
  }

  if (!skipFirstRunFlag) {
    const movementDetails = utilities.analyzeMovement(logger, accel, accelerationX, result.accelX, accelerationY, result.accelY, accelerationZ, result.accelZ);
    utilities.logData(logger, `Occupancy status: ${movementDetails.isOccupied}, state: ${movementDetails.flag}, time diff: ${timeDiff}, accel diff: ${accelDiff}`);

    result.accel = accel;
    result.accelX = accelerationX;
    result.accelY = accelerationY;
    result.accelZ = accelerationZ;
    result.updatedAt = workHourDetails.currentTime;
    result.moveCount = updateMoveCount(result.moveCount, movementDetails.isOccupied);
    updateBeaconFlag = true;
    const verbiage = (movementDetails.isOccupied) ? 'occupied' : 'unoccupied';
    utilities.logData(logger, `Chair is ${verbiage}, so move count is now ${result.moveCount} with continous count ${result.notifyCount}`);

    if (result.moveCount >= utilities.MIN_MOVEMENT_COUNT) {
      utilities.logData(logger, `Sit time of ${timeDiff} logged.`);
      result.sitTime += timeDiff;
      result = trackContinousSitTime(result, workHourDetails.currentTime);
    }

    result = trackContinousDailyTime(result, workHourDetails.currentTime);
  }

  if (updateBeaconFlag) {
    utilities.logData(logger, 'Updating beacon');
    updateBeacon(result, event);
  }

  if (createReportFlag) {
    utilities.logData(logger, 'Updating report');
    saveReport(userReport);
  }

  return result;
}

function fetchUserIDAndSaveBeacon(beacon) {
  utilities.logData(logger, `Getting slack userId for beacon ${beacon.deviceId} email ${beacon.email}`);
  request.post('https://slack.com/api/users.lookupByEmail',
    { form: { token: beacon.appToken, email: beacon.email } },
    (error, response, body) => {
      if (!error && response.statusCode === 200) {
        const parsedBody = JSON.parse(body);
        if (parsedBody && parsedBody.user && parsedBody.user.id) {
          beacon.userId = parsedBody.user.id;
          beacon.save((err, result) => {
            if (err) throw err;
            utilities.logData(logger, `Created beacon with deviceId ${result.deviceId}`);
            utilities.logData(logger, `Found slack user ${result.userId}`);
            const slackMsg = utilities.getWelcomeMsg();
            utilities.notifySlackUser(result.botToken, slackMsg, result.userId);
          });
        }
      } else {
        utilities.logData(logger, 'Error encountered while using the slack token!');
      }
    });
}

function getTokenAndSaveBeacon(beacon) {
  SlackToken.findOne({ teamId: beacon.teamId }, (err, result) => {
    if (err) throw err;
    if (result) {
      beacon.appToken = result.appToken;
      beacon.botToken = result.botToken;
      fetchUserIDAndSaveBeacon(beacon);
    }
  });
}

function processEvent(event) {
  const workHourDetails = utilities.getWorkHourDetails(moment());
  if (workHourDetails.isDuringWorkHrs && utilities.isBeaconAccelerometer(event)) {
    const tags = utilities.getEmailAndTeamId(event);
    if (tags.email !== '' && tags.teamId !== '') {
      Beacon.findOne({ deviceId: event.deviceId }, (err, result) => {
        if (err) throw err;
        if (!result) {
          const aBeacon = createBeaconModel(event, tags, workHourDetails);
          getTokenAndSaveBeacon(aBeacon);
        } else if (utilities.isTimeDiffExceeded(workHourDetails.currentTime) && result.teamId === tags.teamId && result.email === tags.email) {
          computeDiffAndNotify(workHourDetails, result, event);
        }
      });
    }
  }
}

socket.on('appearance', processEvent);
socket.on('displacement', processEvent);
socket.on('keep-alive', processEvent);
