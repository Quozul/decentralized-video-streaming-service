const socket = io();

socket.on("user connected", buildUserList)
socket.on("user disconnected", buildUserList)

const peer = new Peer({
    host: window.location.hostname,
    port: 443,
    path: '/peerjs/myapp',
    secure: true,
});

const files = document.getElementById("files");
const fileBrowser = document.getElementById("fileBrowser");
const userBrowser = document.getElementById("userBrowser");
const users = document.getElementById("users");
const path = document.getElementById("path");
const status = document.getElementById("status");
const disconnect = document.getElementById("disconnect");
const loading = document.getElementById("loading");
const working = document.getElementById("working");
/** @type {HTMLVideoElement} */
const video = document.getElementById("video");

video.addEventListener("progress", (e) => { console.log(e.type); });
video.addEventListener("seeked", (e) => { console.log(e.type); });
video.addEventListener("seeking", (e) => { console.log(e.type); });
video.addEventListener("stalled", (e) => { console.log(e.type); });
video.addEventListener("suspend", (e) => { console.log(e.type); });
video.addEventListener("timeupdate", (e) => { console.log(e.type); });
video.addEventListener("volumechange", (e) => { console.log(e.type); });
video.addEventListener("waiting", (e) => { console.log(e.type); });
video.addEventListener("ratechange", (e) => { console.log(e.type); });
video.addEventListener("playing", (e) => { console.log(e.type); });
video.addEventListener("play", (e) => { console.log(e.type); });
video.addEventListener("pause", (e) => { console.log(e.type); });
video.addEventListener("loadedmetadata", (e) => { console.log(e.type); });
video.addEventListener("loadeddata", (e) => { console.log(e.type); });
video.addEventListener("ended", (e) => { console.log(e.type); });
video.addEventListener("emptied", (e) => { console.log(e.type); });
video.addEventListener("durationchange", (e) => { console.log(e.type); });
video.addEventListener("complete", (e) => { console.log(e.type); });
video.addEventListener("canplaythrough", (e) => { console.log(e.type); });
video.addEventListener("canplay", (e) => { console.log(e.type); });
video.addEventListener("audioprocess", (e) => { console.log(e.type); });

video.addEventListener("timeupdate", (e) => {
    console.log(video.buffered.start(0), video.buffered.end(0));
    if (video.currentTime + 1 >= video.buffered.end(0)) {
        working.innerText = "Requesting stream data...";
        conn.send(["data"]);
    }
});
/*
video.addEventListener("waiting", (e) => {
    conn.send(["data"]);
});

video.addEventListener("progress", (e) => {
    video.play();
});
*/
let conn, previous = [];

function buildUserList() {
    working.innerText = "Building user list...";
    peer.listAllPeers((r) => {
        userBrowser.innerHTML = "";
        for (let i = 0; i < r.length; i++) {
            if (r[i] !== peer.id) {
                const div = document.createElement("div");
                div.innerText = r[i];

                div.addEventListener("click", () => {
                    connect(r[i]);
                });

                userBrowser.append(div);
            }
        }
        working.innerText = "Ready!";
    });
}

/**
 * @param {string} name Name of the file or folder
 * @param {string} kind Either "directory" or "file"
 * @param {Blob} blob
 */
function buildDirectoryElement(name, kind, blob) {
    const div = document.createElement("div");
    div.innerText = name;

    if (kind === "directory") {
        div.addEventListener("click", () => {
            if (working.innerText !== "Ready!") return;
            previous.push(name);
            changeDirectory();
            conn.send(["dir", previous]);
        });
    } else {
        if (blob !== undefined) {
            const src = URL.createObjectURL(new Blob([blob]));
            const img = document.createElement("img");
            img.style.width = "100px";
            img.style.height = "100px";
            img.style.objectFit = "contain";
            img.src = src;
            div.prepend(img);
        }

        div.addEventListener("click", () => {
            if (working.innerText !== "Ready!") return;
            working.innerText = "Preparing your file...";
            loading.style.opacity = "1";
            loading.style.width = "100vw";
            conn.send(["file", [...previous, name]]);
        });
    }

    fileBrowser.append(div);
}

function changeDirectory() {
    working.innerText = "Changing directory...";
    console.log(fileBrowser);
    fileBrowser.innerHTML = "";
    loading.style.opacity = "1";
    buildDirectoryView();
}

function buildDirectoryView() {
    path.innerText = "/" + previous.join("/");

    // Back button
    if (previous.length > 0) {
        const div = document.createElement("div");

        div.innerText = "← Back";
        div.addEventListener("click", () => {
            if (working.innerText !== "Ready!") return;
            previous.pop();
            changeDirectory();
            conn.send(["dir", previous]);
        });

        fileBrowser.append(div);
    }
}

peer.on("open", buildUserList);

/**
 * @param {string} action
 */
function controls(action) {
    conn.send(["controls", action]);
}

/** @type {MediaSource} */
let mediaSource;
/** @type {SourceBuffer} */
let sourceBuffer;

/**
 * @param {string} id
 */
function connect(id) {
    conn = peer.connect(id);
    previous = [];
    conn.on("open", () => {
        status.innerText = `You are connected.`;
        disconnect.style.display = "block";
        users.style.display = "none";
        files.style.display = "block";
        disconnect.addEventListener("click", () => {
            conn.close();
        });
    });

    conn.on("data", async (data) => {
        const [action, content] = data;
        switch (action) {
            case "dir": {
                const [current, total, name, kind, mime, blob] = content;
                loading.style.width = `${current / total * 100}vw`;

                if (kind === "file" && mime) {
                    const type = mime.split("/")[0];
                    if (type === "video" || type === "image") {
                        buildDirectoryElement(name, kind, blob);
                    }
                } else if (kind === "directory") {
                    buildDirectoryElement(name, kind, blob);
                }

                if (current === total) {
                    loading.style.opacity = "0";
                    working.innerText = "Ready!";
                }

                break;
            }
            case "file": {
                const [size, name, mime] = content;
                loading.style.opacity = "0";
                console.log(mime, MediaSource.isTypeSupported(mime));

                if (!MediaSource.isTypeSupported(mime)) {
                    console.log("Type not supported")
                    working.innerText = "Video file can't be streamed.";
                    break;
                }

                mediaSource = new MediaSource();
                mediaSource.onsourceopen = function (e) {
                    console.log("Media source opened");

                    console.log("Adding source");
                    sourceBuffer = mediaSource.addSourceBuffer(mime); // Create new buffer
                    sourceBuffer.mode = "sequence";

                    working.innerText = "Requesting stream data...";
                    conn.send(["data"]); // Ask for data
                }

                mediaSource.onsourceclose = function (e) {
                    console.log("Media source closed");
                }

                mediaSource.onsourceended = function (e) {
                    console.log("Media source ended");
                }

                video.src = URL.createObjectURL(mediaSource);

                break;
            }
            case "data": {
                const [value, done] = content;
                console.log("Received data");
                working.innerText = "Ready!";
                if (!done) {
                    sourceBuffer.appendBuffer(value);
                    video.play();
                } else {
                    mediaSource.endOfStream();
                }
                break;
            }
        }
    });

    conn.on("close", () => {
        disconnect.style.display = "none";
        users.style.display = "block";
        files.style.display = "none";
        status.innerText = `You are currently not connected.`;
        fileBrowser.innerHTML = "Lost connection";
    });
}
