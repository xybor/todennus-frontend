const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const axios = require('axios');
const winston = require('winston');
const { env } = require('process');
const app = express();

require('dotenv').config();

const logger = winston.createLogger({
    level: 'debug', // Set the default log level
    format: winston.format.combine(
        winston.format.timestamp(),  // Add a timestamp to the logs
        winston.format.json()        // Format logs as JSON
    ),
    transports: [
        new winston.transports.Console(), // Log to the console
    ],
});

// Body parser middleware
app.use(bodyParser.urlencoded({ extended: false }));

// Set EJS as the templating engine
app.set('view engine', 'ejs');

// Serve static files (CSS)
app.use('/static', express.static(path.join(__dirname, 'static')));


// Home route
app.get('/', (req, res) => {
    res.redirect('/login');
});

// Login page route
app.get('/login', (req, res) => {
    res.render('login', { error: req.query.error });
});

// Handle login submission
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const { authorization_id } = req.query;
    logger.debug('login-request', { 'authorization_id': authorization_id, 'username': username });

    const userValidateURL = new URL(process.env.USER_VALIDATION_API)
    const userValidateBody = {
        'username': username,
        'password': password
    };

    const authCallbackBody = {};

    await axios.post(userValidateURL.href, userValidateBody).then(response => {
        logger.debug('user-validate-response', { 'status': response.status, 'data': response.data })
        if (response.status != 200) {
            authCallbackBody.success = false;
            authCallbackBody.error = response.data.error;
            authCallbackBody.error_description = response.data.error_description;
        } else {
            authCallbackBody.success = true;
            authCallbackBody.user_id = response.data.data.id;
            authCallbackBody.username = response.data.data.username;
        }
    }).catch(error => {
        logger.warn('failed-to-validate-user:', { 'response': error.response.data });
        authCallbackBody.success = false;
        authCallbackBody.error = error.response.data.error;
        authCallbackBody.error_description = error.response.data.error_description;
    });

    authCallbackBody.idp_secret = process.env.TODENNUS_IDP_SECRET;
    authCallbackBody.authorization_id = authorization_id;

    const authCallbackURL = new URL(process.env.TODENNUS_AUTH_CALLBACK_URL)
    await axios.post(authCallbackURL.href, authCallbackBody).then(response => {
        logger.debug('auth-callback-response', { 'status': response.status, 'data': response.data })
        res.redirect(301, process.env.TODENNUS_SESSION_UPDATE_URL + '?authentication_id=' + response.data.data.authentication_id)
    }).catch(error => {
        logger.warn('failed-to-auth-callback', { 'response': error });
        res.write('invalid response')
    });
});


// Start server
app.listen(3000, () => {
    console.log('Server is running on http://localhost:3000');
});
