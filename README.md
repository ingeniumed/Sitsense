# SitSense

This webservice talks to a Pareto backend in order to make sense of the realtime data coming in from the beacons, more specifically accelerometer beacons. The data coming in is analyzed to make sense of the sittings habits one is following, and use it to notify via slack if one should get up or not.

As an architectural note, while the app is specific to the data model that Pareto provides, it is possible to change the notification endpoint from slack to something else like Discord.

## Architecture

webService: This is designed to read the pareto side in, transform it, store the data and notify via slack
auth: This is used to install the sitsense slack app, and allow slash commands from within slack to work

### Setup

* Install MongoDB from [here](https://www.mongodb.com/download-center/community)

* Install NodeJS LTS from [here](https://nodejs.org/en/download/)

* In MongoDB, create a database called sitsense along with 4 collections - beacons, reports, slacktokens, and timevaults

* Go to webservice as well as auth, and run `npm install`

* Auth runs on port 4390, while webservice runs as an event comes in from pareto (it only accepts if its during business hours of 8-7, mon - fri and if the beacon as proper tags in place)

## DB Notes

* DailySitTime - represents the sit time from Monday till the current day of the week, and is reset every monday
* SitTime - represents the sit time for the day and is reset the next day