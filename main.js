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
    //console.log("a client connected", client.getId());
    io.emit("user connected", client.getId());
});

peerServer.on('disconnect', (client) => {
    //console.log("a client disconnected", client.getId());
    io.emit("user disconnected", client.getId());
});

app.use('/peerjs', peerServer);

// https://github.com/Quozul/quozul.dev/commit/bc688417474b830d8c7c93602e867237e5d63dcd#diff-7bc7852aa59f7f227355a565a6c0deb932006d951752734232558c29d05d4083R17-R30
function recursive_dir_scan(directory) {
    let files = [];

    for (const file of fs.readdirSync(directory)) {
        if (file.startsWith(".")) continue;

        const path = directory + '/' + file;
        const stats = fs.statSync(path);
        if (stats.isDirectory())
            files.push({ dir: file, content: recursive_dir_scan(path) });
        else if (file.endsWith(".mp4"))
            files.push(file);
    };

    return files;
}

const root = "S:\\Videos\\Animes";

const filepaths = recursive_dir_scan(root);

let filePath = "/Is the Order a Rabbit\\Season 1 - Is the Order a Rabbit\\0 - NA - PV.mp4";

app.get('/', (req, res) => {
    res.send("Hello World!");
});

app.get('/tv', (req, res) => {
    res.sendFile(__dirname + '/views/tv.html');
});

app.get('/tv_experimental', (req, res) => {
    res.sendFile(__dirname + '/views/tv_experimental.html');
});

app.get('/remote_experimental', (req, res) => {
    res.sendFile(__dirname + '/views/remote_experimental.html');
});

app.get('/remote', (req, res) => {
    res.sendFile(__dirname + '/views/remote.html');
});

// https://dev.to/abdisalan_js/how-to-code-a-video-streaming-server-using-nodejs-2o0
app.get("/video*", function (req, res) {
    if (!req.params[0]) {
        res.status(400).send("Invalid video path");
        return;
    }

    // Ensure there is a range given for the video
    const range = req.headers.range;
    if (!range) {
        res.status(400).send("Requires Range header");
    }

    // get video stats (about 61MB)
    const videoPath = root + req.params[0];
    const videoSize = fs.statSync(videoPath).size;

    // Parse Range
    // Example: "bytes=32324-"
    const CHUNK_SIZE = 10 ** 6; // 1MB
    const start = Number(range.replace(/\D/g, ""));
    const end = Math.min(start + CHUNK_SIZE, videoSize - 1);
    //start = Math.min(start, end);

    // Create headers
    const contentLength = end - start + 1;
    const headers = {
        "Content-Range": `bytes ${start}-${end}/${videoSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": contentLength,
        "Content-Type": "video/mp4",
        "Cache-Control": "no-store",
    };

    // HTTP Status 206 for Partial Content
    res.writeHead(206, headers);

    // create video read stream for this particular chunk
    const videoStream = fs.createReadStream(videoPath, { start, end });

    // Stream the video chunk to the client
    videoStream.pipe(res);
});

app.get('/files', (req, res) => {
    res.set("Content-Type", "application/json")
    res.send(JSON.stringify(filepaths));
});

app.get('/subtitles', (req, res) => {
    let filepath = (root + filePath).replace(".mp4", ".fr-FR.ass");
    if (!fs.existsSync(filepath)) {
        filepath = (root + filePath).replace(".mp4", ".en-US.ass");
    }
    
    if (fs.existsSync(filepath)) {
        const contentLength = fs.statSync(filepath).size;

        const headers = {
            "Content-Length": contentLength,
            "Content-Type": "text/plain",
            "Cache-Control": "no-store",
        }

        res.writeHead(200, headers);

        res.write(fs.readFileSync(filepath).toString());
    } else {
        res.sendStatus(404);
    }
});

app.get('/js/:file', (req, res) => {
    res.sendFile(__dirname + "/js/" + req.params.file);
});

io.on('connection', (socket) => {
    socket.emit("read", filePath);

    socket.on('watch', msg => {
        filePath = msg;
        io.emit('read', filePath);
    });

    socket.on("controls", msg => {
        io.emit('controls', msg);
    });
});

/*http.listen(port, () => {
    console.log(`Socket.IO server running at http://localhost:${port}/`);
});*/