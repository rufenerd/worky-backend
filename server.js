const express = require('express');
const cors = require('cors');
const moment = require('moment-timezone');
const schedule = require('node-schedule');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

let punches = [];
let lastTexts = [];

app.get('/punches', (req, res) => {
    try {
        const sortedPunches = punches.sort((a, b) => a.epochMillis - b.epochMillis);
        res.send(sortedPunches);
    } catch (error) {
        console.error(error);
        res.status(500).send('Error retrieving punches');
    }
});

app.post('/punch', (req, res) => {
    const { isIn, epochMillis } = req.body;
    try {
        const newPunch = { isIn, epochMillis };
        punches.push(newPunch);
        console.log("PUNCH: ", newPunch)
        res.send([newPunch]);
    } catch (error) {
        console.error(error);
        res.status(500).send('Error storing punch');
    }
});

app.post('/reset', (req, res) => {
    try {
        punches = []
        res.send("ok");
    } catch (error) {
        console.error(error);
        res.status(500).send('Error resetting');
    }
});

app.listen(3000, '0.0.0.0', () => {
    console.log('Server is running on port 3000');
});

const calculateTotalInDurationForToday = () => {
    let totalInDuration = 0;
    let lastInTime = null;

    const startOfToday = moment.tz("America/Los_Angeles").startOf('day');
    const endOfToday = moment.tz("America/Los_Angeles").endOf('day');

    const todayPunches = punches.filter(punch => {
        const punchTime = moment.tz(punch.epochMillis, "America/Los_Angeles");
        return punchTime.isBetween(startOfToday, endOfToday, null, '[]');
    });

    for (let i = 0; i < todayPunches.length; i++) {
        const punch = todayPunches[i];

        if (punch.isIn) {
            if (lastInTime === null) {
                lastInTime = punch.epochMillis;
            }
        } else {
            if (lastInTime !== null) {
                totalInDuration += punch.epochMillis - lastInTime;
                lastInTime = null;
            }
        }
    }

    if (lastInTime !== null) {
        totalInDuration += Date.now() - lastInTime;
    }

    return totalInDuration;
};

const isLunchBreak = () => {
    const now = moment.tz("America/Los_Angeles");
    return (now.hour() === 11 && now.minute() >= 50) ||
        (now.hour() === 12) ||
        (now.hour() === 13 && now.minute() <= 30);
};

const isNightOrWeekend = () => {
    const now = moment.tz("America/Los_Angeles");
    const day = now.day(); // 0 = Sunday, 6 = Saturday
    const hour = now.hour();

    const isWeekend = (day === 0 || day === 6);
    const isNight = (hour >= 19 || hour < 9);

    return isNight || isWeekend;
};

const afterHours = () => {
    if (isNightOrWeekend()) {
        return true;
    }
    const now = moment.tz("America/Los_Angeles");
    const hour = now.hour();
    const minute = now.minute()
    return (hour > 17) || (hour == 17 && minute > 15)
}

const maybeText = async () => {
    if (isNightOrWeekend()) {
        return;
    }

    try {
        if (!punches.length) {
            console.error("no punches");
            return;
        }

        const lastPunch = punches[punches.length - 1];
        const lastTextTime = lastTexts.length ? lastTexts[lastTexts.length - 1].epochMillis : null;

        if (lastTextTime && lastTextTime > lastPunch.epochMillis) {
            console.log("already sent text", lastTextTime, lastPunch.epochMillis);
            return;
        }

        const inDuration = calculateTotalInDurationForToday();

        if (lastPunch.isIn) {
            console.log("IN", inDuration);
            if (inDuration > process.env.MAX_IN_DURATION) {
                console.log("should text wrap it up");
                sendText("Ok, wrap it up.");
            }
        } else {
            console.log("OUT", inDuration);
            if (!afterHours() && !isLunchBreak() && Date.now() - lastPunch.epochMillis > process.env.MAX_OUT_DURATION) {
                console.log("should text where at");
                sendText("Where you at?");
            }
        }
    } catch (error) {
        console.error('Error processing maybeText:', error);
    }
};

setInterval(maybeText, 60000);

const sendText = (message) => {
    console.log("sending text: " + message);
    const client = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

    client.messages
        .create({
            body: message,
            from: '+18556530788',
            to: process.env.PHONE_NUMBER
        })
        .then(message => {
            const now = Date.now();
            console.log(message.sid, now);
            lastTexts.push({ epochMillis: now });
        })
        .catch(error => console.error('Error sending message:', error));
};
let rule = new schedule.RecurrenceRule();
rule.tz = 'America/Los_Angeles';
rule.second = 0;
rule.minute = 0;
rule.hour = 0;
schedule.scheduleJob(rule, () => {
    const now = moment.tz("America/Los_Angeles");
    console.log(`Clearing data at midnight Pacific Time: ${now.format()}`);
    punches = [];
    lastTexts = [];
});
