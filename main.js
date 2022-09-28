const fs = require('fs');
const https = require('https');
const { ExpressPeerServer } = require('peer');
const express = require('express');
const app = express();

const options = {
    key: fs.readFileSync(__dirname + '/ssl/file.pem'),
    cert: fs.readFileSync(__dirname + '/ssl/file.crt'),
};
const serverPort = 8080;

const server = https.createServer(options, app);

server.listen(serverPort);

const peerServer = ExpressPeerServer(server, {
    path: '/',
    allow_discovery: true,
    ssl: {
        key: options.key,
        cert: options.cert,
    },
});

peerServer.on('connection', (client) => {
    console.log("A client connected", client.getId());
});

peerServer.on('disconnect', (client) => {
    console.log("A client disconnected", client.getId());
});

app.use('/peer', peerServer);

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/views/index.html');
});

app.get('/host', (req, res) => {
    res.sendFile(__dirname + '/views/tv.html');
});

app.get('/view', (req, res) => {
    res.sendFile(__dirname + '/views/remote.html');
});

app.get('/js/*', (req, res) => {
    res.sendFile(__dirname + "/js/" + req.params[0]);
});

app.get('/css/*', (req, res) => {
    res.sendFile(__dirname + "/css/" + req.params[0]);
});
