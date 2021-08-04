let directoryHandle, connection;
/** @type {HTMLVideoElement} */
const video = document.getElementById("video");
/** @type {HTMLImageElement} */
const image = document.getElementById("image");
/** @type {HTMLDivElement} */
const controls = document.getElementById("controls");
/** @type {HTMLCanvasElement} */
const thumbnail = document.getElementById("thumbnail");

const peer = new Peer({
    host: window.location.hostname,
    port: 443,
    path: '/peerjs/myapp',
    secure: true,
});

video.addEventListener("play", () => {
    controls.style.display = "none";
});
video.addEventListener("pause", () => {
    controls.style.display = "block";
});

peer.on("open", (id) => {
    document.getElementById("peerId").innerText = "You're successfully connected, your id is: " + id;
});

/**
 * @param {File} file
 * @param {number} chunksize default to 1 MB
 * @returns {Promise<unknown>}
 */
function readFile(file, chunksize = 1024 * 1024) {
    return new Promise(resolve => {
        const reader = new FileReader();
        reader.readAsArrayBuffer(file);

        let offset = 0;
        reader.onload = function (e) {
            const buffer = e.target.result;

            resolve(function * () {
                while (offset < file.size) {
                    yield buffer.slice(offset, offset + chunksize);
                    offset += chunksize;
                }
            });
        }
    });
}

function readFFmpeg(ffmpeg, filename = "fragmented.mp4", chunksize = 1024 * 1024) {
    let offset = 0;
    let ratio = 0;
    let asked = false;
    /** @type {Uint8Array} */
    let fragmented;

    function sendFragment() {
        if (fragmented && fragmented.length > offset) {
            const newOffset = Math.min(fragmented.length, offset + chunksize + 1);
            const f = fragmented.slice(offset, newOffset);
            offset = newOffset;
            asked = false;
            return f;
        } else {
            asked = true;
            return null;
        }
    }

    return {
        setRatio: (newRatio) => {
            ratio = newRatio;

            try {
                fragmented = ffmpeg.FS("readFile", "fragmented.mp4");
            } catch (e) {
                console.warn(e);
            }

            if (ratio === 1) {
                console.log("Removing fragmented file from ffmpeg");
                ffmpeg.FS("unlink", "fragmented.mp4");
            }

            if (asked && newRatio > 0) {
                const f = sendFragment(fragmented);
                if (f !== null) {
                    console.log("Sending data...");
                    connection.send(["data", [f, false]]);
                }
            }
        },
        reader: function* () {
            while (ratio !== 1 || offset < fragmented.length) {
                try {
                    const f = sendFragment(fragmented);
                    if (f === null) {
                        console.log("Waiting for data...", f);
                    }
                    yield f;
                } catch (e) {
                    asked = true;
                    yield null;
                }
            }
        },
    }
}

let subtitlesInstance;
peer.on('connection', (conn) => {
    console.log("User connected " + conn.peer);
    if (connection) connection.close(); // Disconnect previously connected user
    connection = conn;

    let filename;
    let filereader;

    conn.on("data", async (data) => {
        if (!directoryHandle) return;

        // Receive instruction
        const [action, content] = data;

        switch (action) {
            case "dir": {
                console.log("User viewing folder /" + content.join("/"));
                /** @type {FileSystemFileHandle|FileSystemDirectoryHandle} */
                const handler = await findHandler(directoryHandle, content);
                sendDirectory(handler);
                break;
            }
            case "file": {
                console.log("User viewing file /" + content.join("/"));
                const path = Array.from(content);
                filename = path.pop();
                const fileDirectoryHandle = await findHandler(directoryHandle, path);
                const handler = await findHandler(fileDirectoryHandle, [filename]);
                /** @type {File} */
                const file = await handler.getFile();

                if (file.type === "video/mp4") {
                    const mp4boxfile = MP4Box.createFile();
                    mp4boxfile.onError = function(e) { console.error(e); };

                    mp4boxfile.onReady = async function(info) {
                        console.log(info.mime, MediaSource.isTypeSupported(info.mime));

                        if (MediaSource.isTypeSupported(info.mime) && info.isFragmented) {
                            // Video file can be streamed as is
                            filereader = (await readFile(file))();

                            conn.send(["file", [file.size, file.name, info.mime]]);
                        } else {
                            // Video file must be converted as the format is not compatible with MediaSource
                            // Doc: https://askubuntu.com/a/353282
                            // https://developer.mozilla.org/en-US/docs/Web/API/Media_Source_Extensions_API/Transcoding_assets_for_MSE
                            console.log("Converting file...");

                            const ffmpeg = FFmpeg.createFFmpeg({ log: false });

                            if (!ffmpeg.isLoaded()) {
                                console.log("Initializing FFmpeg...");
                                await ffmpeg.load();
                            }

                            ffmpeg.FS("writeFile", file.name, new Uint8Array(await file.arrayBuffer()));

                            const reader = readFFmpeg(ffmpeg);
                            filereader = reader.reader();

                            let sent = false, offset = 0;
                            ffmpeg.setProgress(({ ratio }) => {
                                // Expected output mime: video/mp4; codecs="avc1.640028,mp4a.40.2"; profiles="iso5,iso6,mp41"
                                if (!sent && ratio > 0) {
                                    console.log("Sending file information");
                                    // When this is sent, the user can ask for data at any moment
                                    conn.send(["file", [-1, "fragmented.mp4", info.mime.replace("isom,", "")]]);
                                    sent = true;
                                }

                                connection.send(["conversion", ratio]);

                                reader.setRatio(ratio);
                            });

                            // Running ffmpeg can be awaited, "-movflags +faststart" allow playing the file while converting
                            await ffmpeg.run('-i', file.name,
                                '-vcodec', 'libx264',
                                '-acodec', 'aac',
                                '-c:v', 'copy',
                                '-c:a', 'copy',
                                '-movflags', 'frag_keyframe+empty_moov+default_base_moof+faststart',
                                'fragmented.mp4');

                            ffmpeg.FS("unlink", file.name);
                            console.log("Conversion done!");
                            try {
                                ffmpeg.exit();
                            } catch (e) {
                                console.warn(e);
                            }
                        }
                    }

                    const reader = new FileReader();
                    reader.readAsArrayBuffer(file);
                    reader.onload = (e) => {
                        const buffer = e.target.result;
                        buffer.fileStart = 0;
                        mp4boxfile.appendBuffer(buffer);
                        mp4boxfile.flush();
                    };
                }

                break;
            }
            case "controls": {
                switch (content) {
                    case "toggle":
                        if (video.paused) video.play();
                        else video.pause();
                        break;
                    case "time+":
                        video.currentTime = Math.min(video.duration, video.currentTime + 10);
                        break;
                    case "time-":
                        video.currentTime = Math.max(0, video.currentTime - 10);
                        break;
                }
                break;
            }
            case "data": {
                const entry = filereader.next();
                //if (entry.value !== null) {
                    //console.log("Requested data...", entry);
                    conn.send(["data", [entry.value, entry.done]]);
                //}
                /*if (entry.done) {
                    try {
                        ffmpeg.FS("unlink", "fragmented.mp4"); // Remove converted file once reading is done
                    } catch (e) {
                        // The file has already been removed, dirty
                    }
                }*/
            }
        }
    });

    conn.on("open", async () => {
        subtitlesInstance?.dispose();
        if (directoryHandle) {
            sendDirectory(directoryHandle);
        }
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
            video.remove();
            context.clearRect(0, 0, canvas.width, canvas.height);
        });
    });
}

/**
 * @param {FileSystemDirectoryHandle} directoryHandle
 * @returns {Promise<any[]>}
 */
async function sendDirectory(directoryHandle) {
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

            if (type === "video") {
                blob = await getThumbnail(file, thumbnail);
            } else {
                blob = file;
            }

            connection.send(["dir", [++i, total, name, handle.kind, file.type, blob]]);
        } else {
            connection.send(["dir", [++i, total, name, handle.kind]]);
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

    if (connection) {
        sendDirectory(directoryHandle);
    }
}
