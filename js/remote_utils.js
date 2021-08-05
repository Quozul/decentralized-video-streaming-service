/**
 * @param {SourceBuffer} sourceBuffer
 * @param {Object<number>} bufferRead
 * @param {ArrayBuffer} buffer
 */
function addBuffer(sourceBuffer, bufferRead, buffer) {
    const track = sourceBuffer.track;

    if (!sourceBuffer.updating && (sourceBuffer.buffered.length === 0 || $("#video").currentTime + BUFFER_SIZE >= sourceBuffer.buffered.end(0))) {
        if (buffer !== null) {
            sourceBuffer.appendBuffer(buffer);
            bufferRead[track]++;
            return true;
        }
    }

    return false;
}

/**
 * @param {DataConnection} conn Peer connection
 * @param {SourceBuffer} sourceBuffer
 * @returns {boolean}
 */
function requestData(conn, waiting, bufferRead, sourceBuffer) {
    const status = $("#status");
    /** @type {HTMLVideoElement} */
    const video = $("#video");

    if (!sourceBuffer.updating && (sourceBuffer.buffered.length === 0 || video.currentTime + BUFFER_SIZE >= sourceBuffer.buffered.end(0))) {
        const track = sourceBuffer.track;
        if (waiting[track]) return false;
        waiting[track] = true;

        const index = bufferRead[track];

        status.innerText = "Requesting stream data...";

        conn.send(["data", {track: track, index: index}]);

        return true;
    }

    return false;
}

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

        mediaSource.onsourceclose = function () {
            console.log("Media source closed");
        }

        mediaSource.onsourceended = function () {
            console.log("Media source ended");
        }

        video.src = URL.createObjectURL(mediaSource);
    });
}

function buildUserList(peer) {
    const userBrowser = $("#userBrowser");
    const status = $("#status");

    status.innerText = "Building user list...";
    peer.listAllPeers((r) => {
        userBrowser.innerHTML = "";
        for (let i = 0; i < r.length; i++) {
            if (r[i] !== peer.id) {
                const div = document.createElement("div");
                div.innerText = r[i];

                div.addEventListener("click", () => {
                    connect(peer, r[i]);
                });

                userBrowser.append(div);
            }
        }
        status.innerText = "You are currently not connected.";
    });
}

/**
 * @param {DataConnection} conn Peer connection
 * @param {string[]} path
 * @param {string} name Name of the file or folder
 * @param {string} kind Either "directory" or "file"
 * @param {Blob} blob
 */
function buildDirectoryElement(conn, path, name, kind, blob) {
    const fileBrowser = $("#fileBrowser");
    const status = $("#status");
    const loading = $("#loading");

    const div = document.createElement("div");
    div.innerText = name;

    if (kind === "directory") {
        div.onclick = () => {
            if (status.innerText !== "Ready!") return;
            path.push(name);
            changeDirectory(path);
            conn.send(["dir", path]);
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
            conn.send(["file", [...path, name]]);
        };
    }

    fileBrowser.append(div);
}

/**
 * @param {string[]} path
 */
function changeDirectory(path) {
    const fileBrowser = $("#fileBrowser");
    const pathSpan = $("#path");
    const status = $("#status");
    const loading = $("#loading");

    status.innerText = "Changing directory...";
    loading.style.opacity = "1";
    fileBrowser.innerHTML = "";
    pathSpan.innerText = "/" + path.join("/");
}

/**
 * @param {MediaSource} mediaSource
 */
function toggleVideo(mediaSource) {
    const files = $("#files");
    const toggle = $("#toggle");
    /** @type {HTMLVideoElement} */
    const video = $("#video");
    const videoContainer = $("#videoContainer");

    if (videoContainer.style.display === "block") {
        video.pause();
        videoContainer.style.display = "none";
        files.style.display = "block";
        toggle.innerText = "Open video";
    } else {
        videoContainer.style.display = "block"
        files.style.display = "none";
        toggle.innerText = "Close video";
        if (mediaSource?.readyState === "open") {
            video.play();
        }
    }
}