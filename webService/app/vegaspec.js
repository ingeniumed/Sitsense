const vega = require('vega');
const fs = require('fs');
const utilities = require('./utility.js');

function getDailyReport(result) {
  const graphDatas = [];
  result.dailyTimes.forEach((dailyTime) => {
    const hour = new Date(dailyTime.time * 1000).getHours();
    const graphData = {
      x: hour,
      y: dailyTime.sit,
      c: 0,
    };
    graphDatas.push(graphData);
  });
  return {
    $schema: 'https://vega.github.io/schema/vega/v5.json',
    width: 500,
    height: 200,
    padding: 5,

    signals: [
      {
        name: 'interpolate',
        value: 'step',
      },
    ],

    data: [
      {
        name: 'table',
        values: graphDatas,
      },
    ],
    scales: [
      {
        name: 'x',
        type: 'point',
        range: 'width',
        domain: { data: 'table', field: 'x' },
      },
      {
        name: 'y',
        type: 'linear',
        range: 'height',
        nice: true,
        zero: true,
        domain: { data: 'table', field: 'y' },
      },
      {
        name: 'color',
        type: 'ordinal',
        range: 'category',
        domain: { data: 'table', field: 'c' },
      },
    ],

    axes: [
      { orient: 'bottom', scale: 'x', title: 'Hour of the Day' },
      { orient: 'left', scale: 'y', title: 'Sit Time (seconds)' },
    ],

    marks: [
      {
        type: 'group',
        from: {
          facet: {
            name: 'series',
            data: 'table',
            groupby: 'c',
          },
        },
        marks: [
          {
            type: 'line',
            from: { data: 'series' },
            encode: {
              enter: {
                x: { scale: 'x', field: 'x' },
                y: { scale: 'y', field: 'y' },
                stroke: { value: '#800000' },
                strokeWidth: { value: 2 },
              },
              update: {
                interpolate: { signal: 'interpolate' },
                fillOpacity: { value: 1 },
              },
            },
          },
        ],
      },
    ],
  };
}

function getWeeklyReport(result) {
  return {
    $schema: 'https://vega.github.io/schema/vega/v5.json',
    width: 400,
    height: 200,
    padding: 5,

    data: [
      {
        name: 'table',
        values: [
          { category: 'Monday', amount: (result.monday) ? result.monday : 0 },
          { category: 'Tuesday', amount: (result.tuesday) ? result.tuesday : 0 },
          { category: 'Wednesday', amount: (result.wednesday) ? result.wednesday : 0 },
          { category: 'Thursday', amount: (result.thursday) ? result.thursday : 0 },
          { category: 'Friday', amount: (result.friday) ? result.friday : 0 },
        ],
      },
    ],
    scales: [
      {
        name: 'xscale',
        type: 'band',
        domain: { data: 'table', field: 'category' },
        range: 'width',
        padding: 0.05,
        round: true,
      },
      {
        name: 'yscale',
        domain: { data: 'table', field: 'amount' },
        nice: true,
        range: 'height',
      },
    ],

    axes: [
      { orient: 'bottom', scale: 'xscale', title: 'Day of the Week' },
      { orient: 'left', scale: 'yscale', title: 'Sit Time (seconds)' },
    ],

    marks: [
      {
        type: 'rect',
        from: { data: 'table' },
        encode: {
          enter: {
            x: { scale: 'xscale', field: 'category' },
            width: { scale: 'xscale', band: 1 },
            y: { scale: 'yscale', field: 'amount' },
            y2: { scale: 'yscale', value: 0 },
          },
          update: {
            fill: { value: 'orange' },
          },
        },
      },
    ],
  };
}

function saveWeeklyReport(result, workHourDetails) {
  const slackMsg = utilities.getMorningMsg(result.prevWeekSitTime, result.prevPrevWeekSitTime, result.imageId, workHourDetails.weekOfYear);
  const view = new vega.View(vega.parse(getWeeklyReport(result)), { renderer: 'none' });
  view
    .toCanvas()
    .then((canvas) => {
      fs.writeFile(`images/${result.imageId}-${workHourDetails.weekOfYear}-weekly.png`, canvas.toBuffer(), (err) => {
        if (err) throw err;
        utilities.notifySlackUser(result.botToken, slackMsg, result.userId);
      });
    })
    .catch((err) => {
      console.error(err);
    });
}

function saveDailyReport(result, logger, workHourDetails) {
  const slackMsg = utilities.getEndOfDayMsg(logger, result, workHourDetails);
  const view = new vega.View(vega.parse(getDailyReport(result)), { renderer: 'none' });
  view
    .toCanvas()
    .then((canvas) => {
      fs.writeFile(`images/${result.imageId}-${workHourDetails.dayOfWeek}-${workHourDetails.weekOfYear}-daily.png`, canvas.toBuffer(), (err) => {
        if (err) throw err;
        utilities.notifySlackUser(result.botToken, slackMsg, result.userId);
      });
    })
    .catch((err) => {
      console.error(err);
    });
}

module.exports = {
  saveDailyReport,
  saveWeeklyReport,
};
