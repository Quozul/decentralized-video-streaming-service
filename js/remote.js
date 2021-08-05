const peer = new Peer({
    host: window.location.hostname,
    port: window.location.port,
    path: '/peer',
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
const toggle = document.getElementById("toggle");
/** @type {HTMLVideoElement} */
const video = document.getElementById("video");
/** @type {HTMLButtonElement} */
const back = document.getElementById("back");

function toggleVideo() {
    const videoVisible = video.style.display === "block";
    if (videoVisible) {
        video.pause();
        video.style.display = "none";
        files.style.display = "block";
        toggle.innerText = "Open video";
    } else {
        video.style.display = "block"
        files.style.display = "none";
        toggle.innerText = "Close video";
        if (mediaSource?.readyState === "open") {
            video.play();
        }
    }
}

toggle.onclick = toggleVideo;

back.onclick = () => {
    if (status.innerText !== "Ready!") return;
    previous.pop();
    changeDirectory();
    conn.send(["dir", previous]);
}

// Play the video when the first few frames are loaded
video.oncanplay = (e) => { video.play(); }

// Amount of seconds to buffer
let bufferSize = 30;
// Prevent data from being fetched again
let waitingData = false;
video.ontimeupdate = (e) => {
    for (const sourceBuffer of mediaSource.sourceBuffers) {
        requestData(sourceBuffer);
    }
}

video.onwaiting = (e) => {
    console.log(e.type);

    if (video.buffered.length > 0 && video.buffered.start(0) < video.currentTime) {
        for (const sourceBuffer of mediaSource.sourceBuffers) {
            requestData(sourceBuffer);
        }
    } else {
        console.log("Reset source buffers");
        for (const sourceBuffer of mediaSource.sourceBuffers) {
            bufferRead[sourceBuffer.track] = 0;

            if (sourceBuffer.buffered.length > 0) {
                sourceBuffer.abort();
                sourceBuffer.remove(sourceBuffer.buffered.start(0), sourceBuffer.buffered.end(0)); // Empty buffers
            }
        }
    }
}

let conn, previous = [];

function buildUserList() {
    status.innerText = "Building user list...";
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
        status.innerText = "You are currently not connected.";
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
        div.onclick = () => {
            if (status.innerText !== "Ready!") return;
            previous.push(name);
            changeDirectory();
            conn.send(["dir", previous]);
        };
    } else {
        if (blob !== null) {
            // Thumbnail
            const src = URL.createObjectURL(new Blob([blob]));
            const img = document.createElement("img");
            img.style.width = "100px";
            img.style.height = "100px";
            img.style.objectFit = "contain";
            img.src = src;
            div.prepend(img);
        } else {
            // File icon
            const fileExt = name.split('.').slice(-1).pop();
            const img = document.createElement('img');

            const icons = getFileIcon(fileExt);

            img.src = `https://quozul.dev/public/assets/icons/${icons[0]?.name}.svg`;
            img.classList.add('icon');
            div.prepend(img);
        }

        div.onclick = () => {
            if (status.innerText !== "Ready!") return;
            status.innerText = "Preparing your file...";
            loading.style.opacity = "1";
            loading.style.width = "100vw";
            conn.send(["file", [...previous, name]]);
        };
    }

    fileBrowser.append(div);
}

function changeDirectory() {
    status.innerText = "Changing directory...";
    loading.style.opacity = "1";
    fileBrowser.innerHTML = "";
    path.innerText = "/" + previous.join("/");
}

peer.on("open", buildUserList);

/** @type {MediaSource} */
let mediaSource;

/**
 * @param {HTMLVideoElement} video
 * @returns {Promise<MediaSource>}
 */
function initMediaStream(video) {
    return new Promise(resolve => {
        const mediaSource = new MediaSource();

        mediaSource.onsourceopen = function () {
            console.log("Media source opened");
            resolve(mediaSource);
        }

        mediaSource.onsourceclose = function (e) {
            console.log("Media source closed");
        }

        mediaSource.onsourceended = function (e) {
            console.log("Media source ended");
        }

        video.src = URL.createObjectURL(mediaSource);
    });
}

/** @type {Object<number>} */
let bufferRead = {};
/** @type {Object<boolean>} */
let waiting = {};

/**
 * @param {SourceBuffer} sourceBuffer
 * @param {ArrayBuffer} buffer
 */
function addBuffer(sourceBuffer, buffer) {
    const track = sourceBuffer.track;

    if (!sourceBuffer.updating && (sourceBuffer.buffered.length === 0 || video.currentTime + bufferSize >= sourceBuffer.buffered.end(0))) {
        if (buffer !== null) {
            sourceBuffer.appendBuffer(buffer);
            bufferRead[track]++;
            return true;
        }
    }

    return false;
}

function requestData(sourceBuffer) {
    if (!sourceBuffer.updating && (sourceBuffer.buffered.length === 0 || video.currentTime + bufferSize >= sourceBuffer.buffered.end(0))) {
        const track = sourceBuffer.track;
        if (waiting[track]) return false;
        waiting[track] = true;

        const index = bufferRead[track];

        status.innerText = "Requesting stream data...";
        //console.log("Requesting stream data for track " + track + " at index " + index);

        conn.send(["data", {track: track, index: index}]);

        return true;
    }

    return false;
}

let instance;

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
        toggle.style.display = "block";
    });

    status.innerText = "Loading...";
    loading.style.opacity = "1";

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
                    status.innerText = "Ready!";
                }

                break;
            }
            case "file": {
                const {duration, timescale, bands, tracks} = content;
                console.log("Received file info", content);
                loading.style.opacity = "0";
                waitingData = false;

                // Revoke previous media source
                if (video.src) {
                    URL.revokeObjectURL(video.src);
                }
                mediaSource = await initMediaStream(video);
                mediaSource.duration = duration / timescale;

                for (const {id, codec, mime} of tracks) {
                    const sourceBuffer = mediaSource.addSourceBuffer(mime);
                    sourceBuffer.track = id;

                    sourceBuffer.onupdateend = function (e) {
                        requestData(sourceBuffer);
                    }

                    bufferRead[id] = 0;

                    conn.send(["data", {track: id, index: bufferRead[id]}]);
                }

                toggleVideo();

                break;
            }
            case "subtitles": {
                console.log("Received subtitles");

                const options = {
                    video: video, // HTML5 video element
                    subUrl: URL.createObjectURL(new Blob([content])), // Link to subtitles
                    workerUrl: '/js/lib/subtitles-octopus-worker.js', // Link to WebAssembly-based file "libassjs-worker.js"
                    legacyWorkerUrl: '/js/lib/subtitles-octopus-worker-legacy.js' // Link to non-WebAssembly worker
                };
                // Revoke previous subtitles url
                URL.revokeObjectURL(instance?.subUrl);
                instance?.dispose();
                instance = new SubtitlesOctopus(options);
                break;
            }
            case "data": {
                const {track, index, data} = content;
                //console.log("Received data for track " + track + " at index " + index);
                status.innerText = "Ready!";

                const updated = addBuffer(mediaSource.sourceBuffers[track - 1], data);
                if (updated) console.warn("We could not update the buffer");
                waiting[track] = false;
                break;
            }
        }
    });

    conn.on("close", () => {
        disconnect.style.display = "none";
        users.style.display = "block";
        files.style.display = "none";
        status.innerText = "You are currently not connected.";
        video.style.display = "none";
        toggle.style.display = "none";
    });
}
