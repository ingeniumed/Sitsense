const request = require('request');
const winston = require('winston');
require('winston-daily-rotate-file');
const path = require('path');

// CONSTANTS
const MIN_ACCEL_THRESHOLD = 0.015;
const MAX_ACCEL_DIFF = 0.005;
const MAX_GRAV_DIFF = 0.00025;
const TIME_DIFF = 5;
const NOTIFICATION_LIMIT = 7200;
const MIN_MOVEMENT_COUNT = 4;
const MAX_MOVEMENT_COUNT = 8;

// FUNCTIONS
function getAcceleration(aX, aY, aZ) {
  const accelSq = (aX ** 2) + (aY ** 2) + (aZ ** 2);
  return accelSq ** 0.5;
}

function getAbsDiff(currentVar, prevVar) {
  return Math.abs(currentVar - prevVar);
}

function getWinston() {
  const { createLogger, format } = winston;
  const transports = [];
  transports.push(
    new winston.transports.DailyRotateFile({
      name: 'file',
      datePattern: 'YYYY-MM-DD',
      filename: path.join(__dirname, 'logs', 'log_sitsense.log'),
      format: format.combine(
        format.timestamp({
          format: 'YYYY-MM-DD HH:mm:ss',
        }),
        format.printf(info => `${info.timestamp} ${info.level}: ${info.message}`),
      ),
      handleExceptions: true,
    }),
  );
  const logger = createLogger({ level: process.env.LOG_LEVEL, transports });
  logger.exitOnError = false;
  return logger;
}

function logData(logger, message) {
  logger.log(process.env.LOG_LEVEL, message);
}

function analyzeMovement(logger, accel, accelX, prevAccelX, accelY, prevAccelY, accelZ, prevAccelZ) {
  const xDiff = getAbsDiff(accelX, prevAccelX);
  const yDiff = getAbsDiff(accelY, prevAccelY);
  const zDiff = getAbsDiff(accelZ, prevAccelZ);

  const axisXDiffFlag = (xDiff > 0);
  const axisYDiffFlag = (yDiff > 0);
  const axisZDiffFlag = (zDiff > 0);

  const axisXFlag = (accelX > MIN_ACCEL_THRESHOLD) && axisXDiffFlag;
  const axisYFlag = (accelY > MIN_ACCEL_THRESHOLD) && axisYDiffFlag;
  const axisZFlag = (accelZ > MIN_ACCEL_THRESHOLD) && axisZDiffFlag;

  logData(logger, `Acceleration diffs -> X: ${xDiff}, Y: ${yDiff}, Z: ${zDiff}`);

  let occupiedFlag = (axisXFlag && axisYFlag && axisZFlag) || (axisXFlag && axisYFlag && !axisZFlag) || (!axisXFlag && axisYFlag && axisZFlag) || (axisXFlag && !axisYFlag && axisZFlag);
  let flag = -1;

  if (occupiedFlag) {
    // Movement is detected, but gotta be sure it meets our thresholds
    occupiedFlag = (xDiff > MAX_ACCEL_DIFF || yDiff > MAX_ACCEL_DIFF || zDiff > MAX_ACCEL_DIFF);
    flag = 1;
  } else {
    occupiedFlag = ((xDiff + yDiff + zDiff) > MAX_ACCEL_DIFF) && ((axisXDiffFlag && axisYDiffFlag && axisZDiffFlag) || (axisXDiffFlag && axisYDiffFlag) || (axisXDiffFlag && axisZDiffFlag) || (axisYDiffFlag && axisZDiffFlag));
    flag = 0;
  }

  if (occupiedFlag && (getAbsDiff(accel, accelX) < MAX_GRAV_DIFF || getAbsDiff(accel, accelY) < MAX_GRAV_DIFF || getAbsDiff(accel, accelZ) < MAX_GRAV_DIFF)) occupiedFlag = false;

  return {
    isOccupied: occupiedFlag,
    flag,
  };
}

function isTimeDiffExceeded(timeDiff) {
  return timeDiff > TIME_DIFF;
}

function isItMonday(workHourDetails, result) {
  return (workHourDetails.dayOfWeek === 1 && result.firstDayNotify);
}

function getWorkHourDetails(moment) {
  const isDuringWorkHrs = (moment.hour() >= 8 && moment.hour() < 19 && moment.day() !== 0 && moment.day() !== 6);
  return {
    isDuringWorkHrs,
    dayOfWeek: moment.day(),
    currentTime: moment.unix(),
    weekOfYear: moment.week(),
  };
}

function isBeaconAccelerometer(event) {
  return (event && event.tiraid && event.tiraid.identifier.advData && event.tiraid.identifier.advData.serviceData && event.tiraid.identifier.advData.serviceData.minew && event.tiraid.identifier.advData.serviceData.minew.productModel === 3);
}

function getEmailAndTeamId(event) {
  let email = '';
  let teamId = '';

  if (event.deviceTags) {
    const deviceTags = event.deviceTags.toString();
    const tags = deviceTags.split(',');
    if (tags && tags.length > 0) {
      const emailTagMatch = tags.filter(s => s.includes('email-->'));
      const teamIdTagMatch = tags.filter(s => s.includes('teamId-'));
      if (emailTagMatch && teamIdTagMatch && teamIdTagMatch.length > 0 && emailTagMatch.length > 0) {
        const [emailMatched] = emailTagMatch;
        const [teamIdMatched] = teamIdTagMatch;
        const emailArr = emailMatched.split('-->');
        const teamIdArr = teamIdMatched.split('-');
        if (emailArr && emailArr.length > 1 && teamIdArr && teamIdArr.length > 1) {
          [, email] = emailArr;
          [, teamId] = teamIdArr;
        }
      }
    }
  }

  return {
    email,
    teamId,
  };
}

function notifySlackUser(token, message, userId) {
  if (!process.env.DEV) {
    const form = {
      channel: userId,
      attachments: message,
      as_user: false,
    };
    request.post({
      url: 'https://slack.com/api/chat.postMessage',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      json: form,
    }, (error) => {
      if (error) throw error;
    });
  }
}

function getWelcomeMsg() {
  return [{
    color: '#E50000',
    text: 'Welcome to SitSense! This is going to be a fun journey!',
  }];
}

function pad(num) {
  return (`0${num}`).slice(-2);
}

function convertSecondsToTime(secs) {
  let minutes = Math.floor(secs / 60);
  secs %= 60;
  const hours = Math.floor(minutes / 60);
  minutes %= 60;

  if (hours > 0) {
    const hoursTxt = (hours > 9) ? `${pad(hours)}h ` : `${hours}h `;
    const minsTxt = (minutes > 9) ? `${pad(minutes)}m` : `${minutes}m`;
    return hoursTxt + minsTxt;
  } if (minutes > 0) {
    return (minutes > 9) ? `${pad(minutes)}m` : `${minutes}m`;
  }
  return (secs > 9) ? `${pad(secs)}s` : `${secs}s`;
}

function getContinousWarning() {
  const colorMsg = '#E50000';
  const textMsg = 'You have been sitting continously for more than an hour, now is a good time to move.';

  return [{
    title: 'Alert',
    color: colorMsg,
    text: textMsg,
  }];
}

function getMorningMsg(prevWeekSitTime, prevPrevWeekSitTime, imageId, weekOfYear) {
  const avgSitTime = prevWeekSitTime / 5;
  const weekSitTimeDiff = prevWeekSitTime - prevPrevWeekSitTime;
  const colorMsg = '#7F00FF';
  let textMsg = '';
  if (weekSitTimeDiff !== 0) {
    const incDecVerbiage = (weekSitTimeDiff > 0) ? 'up' : 'down';
    const improvPercent = (prevPrevWeekSitTime !== 0) ? Math.floor(Math.abs((weekSitTimeDiff / prevPrevWeekSitTime) * 100)) : 0;
    textMsg = `Your sit time was ${incDecVerbiage} ${improvPercent}% last week, for an average sit time of ${convertSecondsToTime(avgSitTime)} a day.`;
  } else {
    textMsg = `Your sit time was the same as last week, for an average sit time of ${convertSecondsToTime(avgSitTime)} a day.`;
  }

  return [{
    title: 'End of Week Report',
    color: colorMsg,
    text: textMsg,
    image_url: `https://api.sitsense.ca/media/${imageId}-${weekOfYear}-weekly.png`,
  }];
}

function getPrevPrevDaySitTime(result, workHourDetails) {
  if (workHourDetails.dayOfWeek === 1 && result.friday && result.thursday) {
    return result.thursday;
  } if (workHourDetails.dayOfWeek === 2 && result.monday && result.friday) {
    return result.friday;
  } if (workHourDetails.dayOfWeek === 3 && result.tuesday && result.monday) {
    return result.monday;
  } if (workHourDetails.dayOfWeek === 4 && result.wednesday && result.tuesday) {
    return result.tuesday;
  } if (workHourDetails.dayOfWeek === 5 && result.thursday && result.wednesday) {
    return result.wednesday;
  }
  return 0;
}

function getPrevPrevDay(workHourDetails) {
  if (workHourDetails.dayOfWeek === 1) {
    return 'Thursday';
  } if (workHourDetails.dayOfWeek === 2) {
    return 'Friday';
  } if (workHourDetails.dayOfWeek === 3) {
    return 'Monday';
  } if (workHourDetails.dayOfWeek === 4) {
    return 'Tuesday';
  } if (workHourDetails.dayOfWeek === 5) {
    return 'Wednesday';
  }
  return 'test';
}

function getEndOfDayMsg(logger, result, workHourDetails) {
  const sitPercent = ((result.sitTime) / (10 * 3600)) * 100;
  const sitTimeFormatted = convertSecondsToTime(result.sitTime);
  const sitTimePrevDay = getPrevPrevDaySitTime(result, workHourDetails);
  const sitTimePrevDiff = Math.abs(result.sitTime - sitTimePrevDay);
  const incDecVerbiage = (sitTimePrevDiff > 0) ? 'up' : 'down';
  const sitTimeDiffFormatted = convertSecondsToTime(sitTimePrevDiff);
  const prevPrevDay = getPrevPrevDay(workHourDetails);
  let colour = '#E50000';
  let slackText = '';
  if (sitPercent >= 0 && sitPercent <= 40) {
    colour = '#00E500';
  } else if (sitPercent > 40 && sitPercent <= 70) {
    colour = '#FFFF00';
  }
  if (prevPrevDay !== 'test' && prevPrevDay !== 'Friday' && prevPrevDay !== 'Thursday' && sitTimePrevDiff !== 0) {
    slackText = `You sat in your chair for ${sitTimeFormatted} yesterday. Compared to ${prevPrevDay}, your sit time is ${incDecVerbiage} ${sitTimeDiffFormatted}`;
  } else {
    slackText = `You sat in your chair for ${sitTimeFormatted} yesterday.`;
  }
  logData(logger, `Slack msg being sent is: ${slackText}`);
  return [{
    title: 'End of Day Report',
    color: colour,
    text: slackText,
    image_url: `https://api.sitsense.ca/media/${result.imageId}-${workHourDetails.dayOfWeek}-${workHourDetails.weekOfYear}-daily.png`,
  }];
}

function isDayToBeReset(updatedAt, currentTime, workHourDetails) {
  return (workHourDetails.dayOfWeek !== 1 && ((Math.abs(updatedAt - currentTime)) / 3600) >= 10);
}

module.exports = {
  getEmailAndTeamId,
  getContinousWarning,
  isBeaconAccelerometer,
  notifySlackUser,
  getWelcomeMsg,
  getWorkHourDetails,
  getEndOfDayMsg,
  getWinston,
  isItMonday,
  isTimeDiffExceeded,
  isDayToBeReset,
  getMorningMsg,
  logData,
  convertSecondsToTime,
  getAcceleration,
  analyzeMovement,
  TIME_DIFF,
  NOTIFICATION_LIMIT,
  MIN_MOVEMENT_COUNT,
  MAX_MOVEMENT_COUNT,
};
