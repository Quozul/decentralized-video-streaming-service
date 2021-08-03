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

let instance;
peer.on('connection', (conn) => {
    if (connection) connection.close(); // Disconnect previously connected user
    connection = conn;

    let filename;
    let filereader;

    conn.on("data", async (data) => {
        if (!directoryHandle) return;

        // Receive instruction
        const [action, content] = data;
        /** @type {FileSystemFileHandle|FileSystemDirectoryHandle} */
        let handler;
        /** @type {File} */
        let file;

        switch (action) {
            case "dir": {
                handler = await findHandler(directoryHandle, content);
                sendDirectory(handler);
                break;
            }
            case "file": {
                const path = Array.from(content);
                filename = path.pop();
                const fileDirectoryHandle = await findHandler(directoryHandle, path);
                const handler = await findHandler(fileDirectoryHandle, [filename]);
                file = await handler.getFile();

                filereader = (await readFile(file))();

                if (file.type === "video/mp4") {
                    const mp4boxfile = MP4Box.createFile();
                    mp4boxfile.onError = function(e) {
                        console.error(e);
                    };
                    mp4boxfile.onReady = function(info) {
                        console.log(info.mime, MediaSource.isTypeSupported(info.mime));
                        if (info.isFragmented) {
                            console.log(info);
                            conn.send(["file", [file.size, file.name, info.mime]]);
                        } else {
                            console.log("Requested file is not fragmented, cannot stream.");
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
                conn.send(["data", [entry.value, entry.done]]);
            }
        }
    });

    conn.on("open", async () => {
        instance?.dispose();
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
 * @param {HTMLCanvasElement} canvas
 * @returns {Promise<Blob>}
 */
function getThumbnail(file, canvas) {
    return new Promise(resolve => {
        const video = document.createElement("video");
        video.style.display = "none";
        document.body.append(video);
        video.src = URL.createObjectURL(file);

        video.addEventListener("loadedmetadata", () => {
            const time = Math.floor(Math.random() * video.duration);
            video.currentTime = time;

            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
        });

        video.addEventListener("timeupdate", () => {
            const context = canvas.getContext('2d');
            context.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);

            canvas.toBlob(blob => {
                resolve(blob);
                video.remove();
            });
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

            if (type === "video" || type === "image") {
                /** @type {Blob} */
                let blob;
                if (type === "video") {
                    blob = await getThumbnail(file, thumbnail);
                } else {
                    blob = file;
                }

                connection.send(["dir", [++i, total, name, handle.kind, file.type, blob]]);
            } else {
                connection.send(["dir", [++i, total, name, handle.kind, file.type]]);
            }
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