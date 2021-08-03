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
/** @type {HTMLVideoElement} */
const video = document.getElementById("video");

let conn, previous = [];

function buildUserList() {
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
            loading.style.opacity = "1";
            previous.push(name);
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
            conn.send(["file", [...previous, name]]);
        });
    }

    fileBrowser.append(div);
}

function buildDirectoryView() {
    fileBrowser.innerHTML = "";
    path.innerText = "/" + previous.join("/");

    // Back button
    if (previous.length > 0) {
        const div = document.createElement("div");

        div.innerText = "← Back";
        div.addEventListener("click", () => {
            previous.pop();
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

    let mediaSource = new MediaSource();
    mediaSource.onsourceopen = function (e) {
        console.log("media source opened")
    }
    /** @type {SourceBuffer} */
    let sourceBuffer;
    video.src = URL.createObjectURL(mediaSource);

    conn.on("data", async (data) => {
        const [action, content] = data;
        switch (action) {
            case "dir": {
                const [current, total, name, kind, mime, blob] = content;
                loading.style.width = `${current / total * 100}vw`;

                if (current === 1) {
                    buildDirectoryView();
                }

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
                }

                break;
            }
            case "file": {
                const [size, name, mime] = content;
                console.log(mime);
                if (sourceBuffer) {
                    console.log("remove source buffer");
                    //mediaSource.removeSourceBuffer(sourceBuffer); // Remove previous buffer
                }

                console.log("adding source");
                sourceBuffer = mediaSource.addSourceBuffer(mime); // Create new buffer
                sourceBuffer.onupdate = function (e) {
                    console.log("update", e);
                }
                console.log(sourceBuffer);
                conn.send(["data"]); // Ask for data
                break;
            }
            case "data": {
                const [value, done] = content;
                if (!done) {
                    console.log("append data", value);
                    sourceBuffer.appendBuffer(value);
                    conn.send(["data"]);
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