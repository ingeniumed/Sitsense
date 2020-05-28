const request = require('request');
const winston = require('winston');
require('winston-daily-rotate-file');
const path = require('path');
require('express-validator/check');
const moment = require('moment-timezone');

moment.suppressDeprecationWarnings = true;
moment.tz.setDefault('America/Toronto');

function getWinston() {
  const { createLogger, format } = winston;
  const transports = [];
  transports.push(
    new winston.transports.DailyRotateFile({
      name: 'file',
      datePattern: 'YYYY-MM-DD',
      filename: path.join(__dirname, 'logs', 'log_sitsense-auth.log'),
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

function notifySlackUser(message, channel) {
  const form = {
    channel,
    text: message,
    as_user: false,
  };
  request.post({
    url: 'https://slack.com/api/chat.postMessage',
    headers: {
      Authorization: `Bearer ${process.env.SLACK_TOKEN}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    json: form,
  }, (error) => {
    if (error) throw error;
  });
}

function getMissingMsgs(logger, results) {
  const msgs = [];
  results.forEach((result) => {
    const convertedDate = moment.unix(result.updatedAt).format('DD MMM YYYY hh:mm a');
    const dateDiff = Math.abs(moment().diff(convertedDate, 'days'));
    if (dateDiff !== 0) {
      const daysPast = `${dateDiff} days ago`;
      const msg = {
        beacon: result.deviceId,
        lastSeen: daysPast,
        user: result.email,
        deletion: (dateDiff > 15) ? 'Delete' : 'Keep',
      };
      msgs.push(msg);
    }
  });

  return msgs;
}

function getSitsenseMsg(result) {
  const sitPercent = ((result.sitTime) / (10 * 3600)) * 100;
  const sitTimeFormatted = convertSecondsToTime(result.sitTime);
  const slackText = `You have sat in your chair for ${sitTimeFormatted} today`;
  let colour = '#E50000';
  if (sitPercent >= 0 && sitPercent <= 40) {
    colour = '#00E500';
  } else if (sitPercent > 40 && sitPercent <= 70) {
    colour = '#FFFF00';
  }

  return {
    color: colour,
    text: slackText,
  };
}


function getSitsenseMsgs(logger, results) {
  const msgs = [];
  results.forEach((result) => {
    msgs.push(getSitsenseMsg(result));
  });

  return {
    title: 'Sit Time Update',
    attachments: msgs,
  };
}

module.exports = {
  getMissingMsgs,
  getSitsenseMsgs,
  notifySlackUser,
  convertSecondsToTime,
  getWinston,
  logData,
};
