const fs = require('fs');
const https = require('https');
const { ExpressPeerServer } = require('peer');
const express = require('express');
const app = express();

const options = {
    key: fs.readFileSync('./ssl/file.pem'),
    cert: fs.readFileSync('./ssl/file.crt')
};
const serverPort = 443;

const server = https.createServer(options, app);
const io = require('socket.io')(server);

server.listen(serverPort);

const peerServer = ExpressPeerServer(server, {
    path: '/myapp',
    ssl: {
        key: options.key,
        cert: options.cert,
    },
    allow_discovery: true,
});

peerServer.on('connection', (client) => {
    console.log("A client connected", client.getId());
    io.emit("user connected", client.getId());
});

peerServer.on('disconnect', (client) => {
    console.log("A client disconnected", client.getId());
    io.emit("user disconnected", client.getId());
});

app.use('/peerjs', peerServer);

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/views/index.html');
});

app.get('/tv_experimental', (req, res) => {
    res.set("Cross-Origin-Embedder-Policy", "require-corp");
    res.set("Cross-Origin-Opener-Policy", "same-origin");
    res.sendFile(__dirname + '/views/tv_experimental.html');
});

app.get('/remote_experimental', (req, res) => {
    res.sendFile(__dirname + '/views/remote_experimental.html');
});

app.get('/js/*', (req, res) => {
    res.sendFile(__dirname + "/js/" + req.params[0]);
});
