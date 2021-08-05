/** @type {FileSystemDirectoryHandle} */
let directoryHandle;
/** @type {HTMLVideoElement} */
const video = $("#video");
/** @type {HTMLImageElement} */
const image = $("#image");
/** @type {HTMLDivElement} */
const controls = $("#controls");
/** @type {HTMLCanvasElement} */
const thumbnail = $("#thumbnail");
/** @type {HTMLUListElement} */
const users = $("#connectedUsers");

const peer = new Peer({
    host: window.location.hostname,
    port: window.location.port,
    path: '/peer',
    secure: true,
});

peer.on("open", (id) => {
    document.getElementById("peerId").innerText = "You're successfully connected, your id is: " + id;
});

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
