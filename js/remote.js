const peer = new Peer({
    host: window.location.hostname,
    port: window.location.port,
    path: '/peer',
    secure: true,
});

const files = $("#files");
const fileBrowser = $("#fileBrowser");
const userBrowser = $("#userBrowser");
const users = $("#users");
const pathSpan = $("#path");
const status = $("#status");
const disconnect = $("#disconnect");
const loading = $("#loading");
const toggle = $("#toggle");
/** @type {HTMLVideoElement} */
const video = $("#video");
const videoContainer = $("#videoContainer");

// CONFIGURATION VARIABLES
// Amount of seconds to buffer
const BUFFER_SIZE = 30;

// Play the video when the first few frames are loaded
video.oncanplay = video.play

peer.on("open", buildUserList);

/**
 * @param {string} id
 */
function connect(id) {
    const conn = peer.connect(id);

    const back = document.getElementById("back");
    /**
     * Names of all folders representing the path
     * @type {string[]}
     */
    let path = [];
    /** @type {MediaSource} */
    let mediaSource;
    /**
     * Used to know where the index of the last read sample was
     * @type {Object<number>}
     */
    let bufferRead = {};
    /**
     * Used to prevent data from being fetched too much
     * @type {Object<boolean>}
     */
    let waiting = {};
    // Subtitles instance
    let instance;

    // Create events
    back.onclick = () => {
        if (status.innerText !== "Ready!") return;
        path.pop();
        changeDirectory(path);
        conn.send(["dir", path]);
    }

    video.ontimeupdate = () => {
        for (const sourceBuffer of mediaSource.sourceBuffers) {
            requestData(conn, waiting, bufferRead, sourceBuffer);
        }
    }

    video.onwaiting = (e) => {
        console.log(e.type);

        if (video.buffered.length > 0 && video.buffered.start(0) < video.currentTime) {
            for (const sourceBuffer of mediaSource.sourceBuffers) {
                requestData(conn, waiting, bufferRead, sourceBuffer);
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

    toggle.onclick = () => toggleVideo(mediaSource);

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
                        buildDirectoryElement(conn, path, name, kind, blob);
                    }
                } else if (kind === "directory") {
                    buildDirectoryElement(conn, path, name, kind, blob);
                }

                if (current === total) {
                    loading.style.opacity = "0";
                    status.innerText = "Ready!";
                }

                break;
            }
            case "file": {
                const {duration, timescale, tracks} = content;
                console.log("Received file info", content);
                loading.style.opacity = "0";

                // Revoke previous media source
                if (video.src) {
                    URL.revokeObjectURL(video.src);
                }

                // Revoke previous subtitles url
                if (instance) {
                    URL.revokeObjectURL(instance.subUrl);
                    instance?.dispose();
                }

                mediaSource = await initMediaStream(video);
                mediaSource.duration = duration / timescale;

                for (const {id, mime} of tracks) {
                    const sourceBuffer = mediaSource.addSourceBuffer(mime);
                    sourceBuffer.track = id;

                    sourceBuffer.onupdateend = function () {
                        requestData(conn, waiting, bufferRead, sourceBuffer);
                    }

                    bufferRead[id] = 0;

                    conn.send(["data", {track: id, index: bufferRead[id]}]);
                }

                toggleVideo(mediaSource);

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
                instance = new SubtitlesOctopus(options);
                break;
            }
            case "data": {
                const {track, data} = content;
                status.innerText = "Ready!";

                const updated = addBuffer(mediaSource.sourceBuffers[track - 1], bufferRead, data);
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
        videoContainer.style.display = "none";
        toggle.style.display = "none";
    });
}
