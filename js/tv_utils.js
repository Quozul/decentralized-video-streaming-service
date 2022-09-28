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
 * Returns a random frame from a video file
 * @param {File} file Video file
 * @returns {Promise<Blob>} Random frame from the video
 */
function getThumbnail(file) {
    return new Promise((resolve, reject) => {
        const video = document.createElement("video");
        video.style.display = "none";
        document.body.append(video);
        video.src = URL.createObjectURL(file);

        /** @type {OffscreenCanvas} */
        let canvas;

        video.addEventListener("loadedmetadata", () => {
            video.currentTime = Math.floor(Math.random() * video.duration);

            canvas = new OffscreenCanvas(video.videoWidth, video.videoHeight);
        });

        video.addEventListener("timeupdate", async () => {
            const context = canvas.getContext('2d');
            context.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);

            const blob = await canvas.convertToBlob({
                type: "image/png",
            });

            resolve(blob);
            URL.revokeObjectURL(video.src);
            video.remove();
            context.clearRect(0, 0, canvas.width, canvas.height);
        });

        video.addEventListener("error", reject);
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
            /** @type {Blob} */
            let blob = null;

            /*if (file.type.split("/")[0] === "video") {
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
 * @returns {Promise<FileSystemDirectoryHandle>}
 */
async function getFile(peer) {
    // Open directory picker
    const directoryHandle = await window.showDirectoryPicker();

    document.getElementById("allowAccess").innerText = "Folder opened: " + directoryHandle.name;

    for (const key in peer.connections) {
        sendDirectory(peer.connections[key][0], directoryHandle);
    }

    return directoryHandle;
}
