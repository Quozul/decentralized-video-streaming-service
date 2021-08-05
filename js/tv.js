let directoryHandle;
/** @type {HTMLVideoElement} */
const video = document.getElementById("video");
/** @type {HTMLImageElement} */
const image = document.getElementById("image");
/** @type {HTMLDivElement} */
const controls = document.getElementById("controls");
/** @type {HTMLCanvasElement} */
const thumbnail = document.getElementById("thumbnail");
/** @type {HTMLUListElement} */
const users = document.getElementById("connectedUsers");

const peer = new Peer({
    host: window.location.hostname,
    port: window.location.port,
    path: '/peer',
    secure: true,
});

peer.on("open", (id) => {
    document.getElementById("peerId").innerText = "You're successfully connected, your id is: " + id;
});

let subtitlesInstance;
peer.on('connection', (conn) => {
    console.log("User connected " + conn.peer);

    const li = document.createElement("li");
    li.innerText = conn.peer;
    users.append(li);

    let buffers;

    conn.on("data", async (data) => {
        if (!directoryHandle) return;

        // Receive instruction
        const [action, content] = data;

        switch (action) {
            case "dir": {
                console.log("User viewing folder /" + content.join("/"));
                /** @type {FileSystemFileHandle|FileSystemDirectoryHandle} */
                const handler = await findHandler(directoryHandle, content);
                sendDirectory(conn, handler);
                break;
            }
            case "file": {
                console.log("User viewing file /" + content.join("/"));
                const path = Array.from(content);
                const filename = path.pop();
                const fileDirectoryHandle = await findHandler(directoryHandle, path);
                const handler = await findHandler(fileDirectoryHandle, [filename]);
                /** @type {File} */
                const file = await handler.getFile();

                // Video file
                if (file.type === "video/mp4") {
                    const generator = await getSegments(file);

                    const info = await generator.next();
                    buffers = (await generator.next()).value;

                    conn.send(["file", info.value]); // Sends the file info to the client

                    const filenameNoExt = filename.split(".").slice(0, -1).join(".");
                    // Get french subtitles
                    let subtitles = await findHandler(fileDirectoryHandle, [filenameNoExt + ".fr-FR.ass"]);
                    if (subtitles === null) {
                        // Fallback to english
                        subtitles = await findHandler(fileDirectoryHandle, [filenameNoExt + ".en-US.ass"]);
                    }
                    if (subtitles !== null) {
                        conn.send(["subtitles", await (await subtitles.getFile()).arrayBuffer()]);
                    }
                } else {
                    // Send raw file content
                    conn.send(["file", {mime: file.type, data: await file.arrayBuffer()}]);
                }
                break;
            }
            case "data": {
                const {track, index} = content;
                const data = buffers[track][index];
                conn.send(["data", {track: track, index: index, data: data}]);
            }
        }
    });

    conn.on("open", async () => {
        if (directoryHandle) {
            sendDirectory(conn, directoryHandle);
        }
    });

    conn.on("close", () => {
        console.log("User disconnected", conn.peer);
        li.remove();
    });
});

/**
 * @param {FileSystemDirectoryHandle} root
 * @param {string[]} path
 * @returns {Promise<FileSystemFileHandle|FileSystemDirectoryHandle>}
 */
async function findHandler(root, path = []) {
    if (path.length === 0) return root;

    const entries = root.entries();
    let entry;
    while ((entry = await entries.next()).done === false) {
        const [name, handle] = entry.value;

        if (name === path[0]) {
            if (path.length === 1) {
                return handle;
            } else {
                return await findHandler(handle, path.slice(1));
            }
        }
    }

    return null;
}

/**
 * @param {File} file
 * @returns {AsyncGenerator<Promise<{id: number, codec: string, mime: string}>, Promise<Object<ArrayBuffer[]>>, *>}
 */
async function * getSegments(file) {
    const buffer = await file.arrayBuffer();
    buffer.fileStart = 0;
    let initSegs;

    const mp4boxfile = MP4Box.createFile();

    mp4boxfile.onError = function (e) { console.error(e); }

    /** @type {Object<ArrayBuffer[]>} */
    const buffers = {};
    let trackCount = 0;

    yield new Promise(resolve => {
        mp4boxfile.onReady = async function (info) {
            console.log("Info", info);

            const options = {nbSamples: 1000, rapAlignement: true};

            const tracks = [];
            trackCount = info.tracks.length;
            for (const {id, codec} of info.tracks) {
                console.log("Track", id);

                // Building per track mime, this saves us from doing a per track analysis
                const mime = `${info.mime.split(";")[0]}; codecs="${codec}"`;
                tracks.push({id: id, codec: codec, mime: mime});

                buffers[id] = [];
                mp4boxfile.setSegmentOptions(id, undefined, options);
            }

            // Return only useful information
            resolve({mime: info.mime, duration: info.duration, timescale: info.timescale, bands: info.bands, tracks: tracks});

            initSegs = mp4boxfile.initializeSegmentation();

            console.log("Received init segments");

            for (const {id, buffer} of initSegs) {
                console.log("Append init segment", buffer);
                buffers[id].push(buffer);
            }
        }

        mp4boxfile.appendBuffer(buffer);
        mp4boxfile.flush();
    });

    return new Promise(resolve => {
        let done = 0;
        mp4boxfile.onSegment = function (id, user, buffer, sampleNumber, last) {
            buffers[id].push(buffer);
            mp4boxfile.releaseUsedSamples(id, sampleNumber);
            if (last && ++done === trackCount) {
                resolve(buffers);
            }
        }

        mp4boxfile.start();
    });
}

/**
 * @param {File} file
 * @returns {Promise<Blob>}
 */
function getThumbnail(file) {
    return new Promise(resolve => {
        const video = document.createElement("video");
        video.style.display = "none";
        document.body.append(video);
        video.src = URL.createObjectURL(file);

        /** @type {OffscreenCanvas} */
        let canvas;

        video.addEventListener("loadedmetadata", () => {
            const time = Math.floor(Math.random() * video.duration);
            video.currentTime = time;

            canvas = new OffscreenCanvas(video.videoWidth, video.videoHeight);
        });

        video.addEventListener("timeupdate", async () => {
            const context = canvas.getContext('2d');
            context.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);

            const blob = await canvas.convertToBlob({
                type: "image/jpeg",
                quality: 0.95
            });

            resolve(blob);
            URL.revokeObjectURL(video.src);
            video.remove();
            context.clearRect(0, 0, canvas.width, canvas.height);
        });
    });
}

/**
 * @param {FileSystemDirectoryHandle} directoryHandle
 * @returns {Promise<any[]>}
 */
async function sendDirectory(conn, directoryHandle) {
    const response = [];

    let total = 0, i = 0;
    const iter = directoryHandle.entries();
    while (!(await iter.next()).done) total++;

    const entries = directoryHandle.entries();
    let entry;
    while (!(entry = await entries.next()).done) {
        const [name, handle] = entry.value;

        if (handle.kind === "file") {
            /** @type {File} */
            const file = await handle.getFile();
            const type = file.type.split("/")[0];
            /** @type {Blob} */
            let blob;

            /*if (type === "video") {
                blob = await getThumbnail(file);
            }*/

            conn.send(["dir", [++i, total, name, handle.kind, file.type, blob]]);
        } else {
            conn.send(["dir", [++i, total, name, handle.kind]]);
        }
    }

    return response;
}

/**
 * @returns {Promise<void>}
 */
async function getFile() {
    // Open directory picker
    directoryHandle = await window.showDirectoryPicker();

    document.getElementById("allowAccess").innerText = "Folder opened: " + directoryHandle.name;

    for (const key in peer.connections) {
        if (peer.connections.hasOwnProperty(key)) {
            sendDirectory(peer.connections[key], directoryHandle);
        }
    }
}
