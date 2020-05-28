const express = require('express');
const request = require('request');
const bodyParser = require('body-parser');
const expressValidator = require('express-validator');
const json2csv = require('json2csv').parse;
const { sanitizeParam } = require('express-validator/filter');
const Report = require('./models/report');
const Beacon = require('./models/beacon');
const SlackToken = require('./models/slackToken');
const utilities = require('./utility.js');

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(expressValidator());
app.set('json spaces', 2);

const PORT = 4390;

const logger = utilities.getWinston();

function createSlackTokenModel(tokenBody) {
  const slackTokenData = new SlackToken();
  slackTokenData.teamName = tokenBody.team_name;
  slackTokenData.teamId = tokenBody.team_id;
  slackTokenData.appToken = tokenBody.access_token;
  slackTokenData.botToken = tokenBody.bot.bot_access_token;
  return slackTokenData;
}

app.listen(PORT, () => {
  utilities.logData(logger, `SitSense slack auth app listening on port ${PORT}`);
});

app.get('/', (req, res) => {
  console.log(process.env);
  res.json({
    version: '1.0.2',
  });
});

app.get('/monitor', (req, res) => {
  const { secretKey } = req.query;

  if (secretKey && secretKey === process.env.SECRET_KEY) {
    Beacon.find({}, (error, results) => {
      if (error) return res.status(500).json({ error });
      if (!results || (results && results.length < 1)) {
        return res.status(404).send({ Error: 'No such endpoints found!' });
      }
      const missingMsgs = utilities.getMissingMsgs(logger, results);
      const jsonString = JSON.stringify(missingMsgs, null, 2);
      utilities.notifySlackUser(jsonString, '#monitoring');
      res.status(200).send({ Message: 'Slack message sent!' });
    });
  } else {
    return res.status(404)
      .send({ Error: 'No such endpoint found!' });
  }
});

app.get('/beacon', (req, res) => {
  const { secretKey } = req.query;

  if (secretKey && secretKey === process.env.SECRET_KEY) {
    Beacon.find({}, (error, results) => {
      utilities.logData(logger, 'Called beacon endpoint with the right key!');
      if (error) return res.status(500).json({ error });
      if (!results || (results && results.length < 1)) {
        return res.status(404).send({ Error: 'No such endpoint found!' });
      }
      const beaconMap = [];
      results.forEach((result) => {
        const beacon = {
          deviceId: result.deviceId,
          rssi: result.rssi,
          email: result.email,
          accel: result.accel,
          hourlySitTime: result.dailyTimes,
          todaySitTime: result.sitTime,
          WeekSitTime: result.dailySitTime,
          lastUpdated: result.updatedAt,
        };
        beaconMap.push(beacon);
      });
      res.status(200).json(beaconMap);
    });
  } else {
    return res.status(404)
      .send({ Error: 'No such endpoint found!' });
  }
});

app.get('/report/:teamId', sanitizeParam('teamId').trim().escape(), (req, res) => {
  const reqTeamId = req.params.teamId;

  const fields = [{
    label: 'Weekly Sit Time',
    value: 'weeklySitTime',
  }, {
    label: 'Week of the Year',
    value: 'weekNumber',
  }, {
    label: 'Email',
    value: 'email',
  }, {
    label: 'Average Daily Sit Time',
    value: 'dailyAverage',
  }];
  Report.find({ teamId: reqTeamId }, (err, entries) => {
    utilities.logData(logger, 'Called report endpoint!');
    if (err) return res.status(500).json({ err });
    if (entries && entries.length < 1) {
      return res.status(404).send({ Error: 'No such endpoint found!' });
    }
    if (!entries) {
      return res.status(404).send({ Error: 'No such endpoint found!' });
    }
    let csv;
    try {
      csv = json2csv(entries, { fields });
      utilities.logData(logger, 'Report sent!');
      return res.status(200)
        .header('Content-Disposition', `attachment; filename = ${reqTeamId}.csv`)
        .type('text/csv')
        .send(csv);
    } catch (error) {
      return res.status(500).json({ error });
    }
  });
});

app.post('/data', (req, res) => {
  const { body } = req;

  if (body && body.user_id) {
    Beacon.find({ userId: body.user_id }, (err, results) => {
      if (err) {
        console.log(err);
        res.send('Sitsense ran into an error. Please contact support@sitsense.ca!');
      }
      if (!results || (results && results.length < 1)) {
        res.send('No sit time has been recorded for today!');
      } else {
        const slackMsg = utilities.getSitsenseMsgs(logger, results);
        utilities.logData(logger, `Requested data via slack for ${body.user_id}, and has been sent!`);
        res.json(slackMsg);
      }
    });
  } else {
    res.send('No sit time has been recorded for today!');
  }
});

app.get('/oauth', (req, res) => {
  if (!req.query.code) {
    res.status(500);
    res.send({ Error: "Looks like we're not getting the oauth code." });
  } else {
    request({
      url: 'https://slack.com/api/oauth.access',
      qs: { code: req.query.code, client_id: process.env.SLACK_CLIENT_ID, client_secret: process.env.SLACK_CLIENT_SECRET },
      method: 'GET',
    }, (errors, response, body) => {
      if (errors) {
        utilities.logData(logger, 'Error encountered while getting the code');
        res.status(500);
        res.send({ Error: 'Sitsense is unable to connect to your Slack. Please message support@sitsense.ca!' });
      } else {
        const responseBody = JSON.parse(body);
        SlackToken.findOne({ teamId: responseBody.team_id }, (err, slackToken) => {
          if (err) throw err;
          if (!slackToken) {
            const aToken = createSlackTokenModel(responseBody);
            aToken.save((error, result) => {
              if (error) throw error;
              utilities.logData(logger, `New client connected to Slack with team id: ${result.teamId} and team name: ${result.teamName}`);
              res.status(200);
              res.send({ Success: `Sitsense has been connected to ${result.teamName} (${result.teamId})` });
            });
          } else {
            res.status(200);
            res.send({ Success: `Sitsense has been previously connected to ${slackToken.teamName} (${slackToken.teamId})` });
          }
        });
      }
    });
  }
});
