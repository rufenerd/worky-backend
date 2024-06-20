const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const moment = require('moment-timezone');
require('dotenv').config();
const path = require('path');
const fs = require('fs');

const pool = new Pool({
    user: process.env.DATABASE_USER,
    host: process.env.DATABASE_HOST,
    database: process.env.DATABASE_NAME,
    password: process.env.DATABASE_PASSWORD,
    port: 5432,
    ssl: {
        rejectUnauthorized: false
    }
});

const app = express();
app.use(express.json());
app.use(cors());

app.get('/punches', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM punches ORDER BY epochMillis ASC');
        res.send(result.rows);
    } catch (error) {
        console.error(error)
        res.status(500).send('Error retrieving punches from database');
    }
});

app.post('/punch', async (req, res) => {
    const { isIn, epochMillis } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO punches (isIn, epochMillis) VALUES ($1, $2) RETURNING *',
            [isIn, epochMillis]
        );
        res.send(result.rows);
    } catch (error) {
        console.error(error)
        res.status(500).send('Error storing punch in database');
    }
});

app.listen(3000, '0.0.0.0', () => {
    console.log('Server is running on port 3000');
});

const calculateTotalInDurationForToday = (punches) => {
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
            lastInTime = punch.epochMillis;
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
}

const isLunchBreak = () => {
    const now = moment.tz("America/Los_Angeles");
    return (now.hour() === 11 && now.minute() >= 50) ||
        (now.hour() === 12) ||
        (now.hour() === 13 && now.minute() <= 30);
}

const isNightOrWeekend = () => {
    const now = moment.tz("America/Los_Angeles");
    const day = now.day(); // 0 = Sunday, 6 = Saturday
    const hour = now.hour();

    const isWeekend = (day === 0 || day === 6);
    const isNight = (hour >= 19 || hour < 9);

    return isNight || isWeekend;
}

const maybeText = async () => {
    if (isNightOrWeekend()) {
        return;
    }

    try {
        const punchesRes = await pool.query('SELECT * FROM punches ORDER BY epochMillis ASC');
        const punches = punchesRes.rows;

        if (!punches.length) {
            return;
        }

        const lastPunch = punches[punches.length - 1];

        const lastTextRes = await pool.query('SELECT * FROM last_text ORDER BY epochMillis DESC LIMIT 1');
        const lastTextTime = lastTextRes.rows.length ? lastTextRes.rows[0].epochmillis : null;

        if (lastTextTime && lastTextTime > lastPunch.epochmillis) {
            return;
        }

        const inDuration = calculateTotalInDurationForToday(punches);

        if (lastPunch.isin) {
            if (inDuration > process.env.MAX_IN_DURATION) {
                sendText("Ok, wrap it up.");
            }
        } else {
            if (inDuration < process.env.MAX_IN_DURATION && !isLunchBreak() && Date.now() - lastPunch.epochmillis > process.env.MAX_OUT_DURATION) {
                sendText("Where you at?");
            }
        }
    } catch (error) {
        console.error('Error querying the database:', error);
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
            const now = Date.now()
            console.log(message.sid, now)
            pool.query('INSERT INTO last_text (epochMillis) VALUES ($1)', [now]);
        })
        .catch(error => console.error('Error sending message:', error));
};
