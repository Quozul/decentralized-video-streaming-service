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

let instance;
peer.on('connection', (conn) => {
    if (connection) connection.close(); // Disconnect previously connected user
    connection = conn;

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
                const filename = path.pop();
                const fileDirectoryHandle = await findHandler(directoryHandle, path);
                const handler = await findHandler(fileDirectoryHandle, [filename]);
                file = await handler.getFile();

                switch (file.type.split("/")[0]) {
                    case "video": {
                        const subtitles = await findHandler(fileDirectoryHandle, [filename.replace(".mp4", ".fr-FR.ass")]);

                        instance?.dispose();

                        if (subtitles !== null) {
                            const options = {
                                video: video, // HTML5 video element
                                subUrl: URL.createObjectURL(await subtitles.getFile()), // Link to subtitles
                                workerUrl: '/js/subtitles-octopus-worker.js', // Link to WebAssembly-based file "libassjs-worker.js"
                                legacyWorkerUrl: '/js/subtitles-octopus-worker-legacy.js' // Link to non-WebAssembly worker
                            };
                            instance = new SubtitlesOctopus(options);
                        }

                        video.src = URL.createObjectURL(file);
                        image.style.display = "none";
                        video.style.display = "block";
                        video.play();
                        break;
                    }
                    case "image": {
                        image.src = URL.createObjectURL(file);
                        image.style.display = "block";
                        video.style.display = "none";
                        video.pause();
                        break;
                    }
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
            const file = await handle.getFile();
            const type = file.type.split("/")[0];

            if (type === "video" || type === "image") {
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