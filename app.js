const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const axios = require('axios');
const winston = require('winston');
const { env } = require('process');
const app = express();

require('dotenv').config();

const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const { log } = require('console');

// Load the proto file
const PROTO_PATH = path.join(__dirname, 'todennus-proto');
const userPackageDefinition = protoLoader.loadSync(path.join(PROTO_PATH, 'user.proto'), {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    includeDirs: [PROTO_PATH], // Add the base proto path for imports
});
const userProto = grpc.loadPackageDefinition(userPackageDefinition);

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

const userRPCClient = new userProto.todennus.proto.service.User(env.USER_VALIDATION_GRPC, grpc.credentials.createInsecure());

// Handle login submission
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const { authorization_id } = req.query;
    logger.debug('login-request', { 'authorization_id': authorization_id, 'username': username });

    const userValidateRequest = {
        'username': username,
        'password': password
    };

    const authCallbackBody = {};
    userRPCClient.Validate(userValidateRequest, async (error, response) => {
        if (error) {
            logGrpcError(error);
            const error_details = error.details.split(":")

            authCallbackBody.success = false;
            authCallbackBody.error = error_details[0];
            if (error_details.length > 1) {
                authCallbackBody.error_description = error_details[1];
            }
        } else {
            authCallbackBody.success = true;
            authCallbackBody.user_id = response.user.id;
            authCallbackBody.username = response.user.username;
        }

        authCallbackBody.idp_secret = env.TODENNUS_IDP_SECRET;
        authCallbackBody.authorization_id = authorization_id;

        const authCallbackURL = new URL(env.TODENNUS_AUTH_CALLBACK_URL)
        await axios.post(authCallbackURL.href, authCallbackBody).then(response => {
            logger.debug('auth-callback-response', { 'status': response.status, 'data': response.data })
            res.redirect(301, env.TODENNUS_SESSION_UPDATE_URL + '?authentication_id=' + response.data.data.authentication_id)
        }).catch(error => {
            logger.warn('failed-to-auth-callback', { 'response': error });
            res.write('invalid todennus response')
        });
    });
});


// Start server
app.listen(3000, () => {
    console.log('Server is running on http://localhost:3000');
});


// Handle gRPC errors
function logGrpcError(error) {
    if (error) {
        var key = 'unknown';
        switch (error.code) {
            case grpc.status.NOT_FOUND:
                key = 'not-found';
                break;
            case grpc.status.INVALID_ARGUMENT:
                key = 'invalid-argument';
                break;
            case grpc.status.UNAVAILABLE:
                key = 'unavailable';
                break;
            case grpc.status.DEADLINE_EXCEEDED:
                key = 'deadline-exceeded';
                break;
            case grpc.status.PERMISSION_DENIED:
                key = 'permission-denined';
                break;
            default:
                key = 'unknown-code:', error.code;
                break;
        }

        // Get the error code and message from the error object
        logger.warn(key, { 'detail': error.details });

    }
}
