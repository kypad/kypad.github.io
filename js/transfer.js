/**
 * Kypad QuickDrop P2P File Transfer Module
 * Connects securely to Cloudflare Edge Signaling via SecurityVault
 * WebRTC DataChannel peer-to-peer file transfer engine
 */
(() => {
"use strict";

let WS_URL = "";
let RTC_CONFIG = null;

async function ensureQuickDropSecurity() {
    if (WS_URL && RTC_CONFIG) return true;
    try {
        const config = await window.SecurityVault.getQuickDropConfig();
        WS_URL = config.wsUrl;
        RTC_CONFIG = config.rtcConfig;
        return true;
    } catch (err) {
        console.error("Security Vault decryption failed:", err);
        return false;
    }
}

/*
 * File chunks.
 */
const CHUNK_SIZE = 64 * 1024;

/*
 * DataChannel backpressure.
 */
const HIGH_WATER_MARK = CHUNK_SIZE * 16;
const LOW_WATER_MARK = CHUNK_SIZE * 8;


/* ==========================================================
   DOM
========================================================== */

const joinPage =
    document.getElementById(
        "joinPage"
    );

const appPage =
    document.getElementById(
        "appPage"
    );

const roomInput =
    document.getElementById(
        "roomInput"
    );

const createButton =
    document.getElementById(
        "createButton"
    );

const joinButton =
    document.getElementById(
        "joinButton"
    );

const roomCode =
    document.getElementById(
        "roomCode"
    );

const copyButton =
    document.getElementById(
        "copyButton"
    );

const statusText =
    document.getElementById(
        "statusText"
    );

const statusDot =
    document.getElementById(
        "statusDot"
    );

const fileInput =
    document.getElementById(
        "fileInput"
    );

const dropZone =
    document.getElementById(
        "dropZone"
    );

const transfers =
    document.getElementById(
        "transfers"
    );

const logs =
    document.getElementById(
        "logs"
    );

const leaveButton =
    document.getElementById(
        "leaveButton"
    );


/* ==========================================================
   STATE
========================================================== */

let room = "";

let isCreator = false;

let socket = null;

let peer = null;

let dataChannel = null;

let peerJoined = false;

let offerSent = false;

let connected = false;

let leaving = false;


/*
 * ICE candidates that arrive before
 * setRemoteDescription().
 */

let pendingCandidates = [];


/*
 * Currently receiving file.
 */

let incomingFile = null;


/*
 * Used to avoid accidental duplicate
 * signal handling.
 */

let receivedOffer = false;


/* ==========================================================
   GENERAL HELPERS
========================================================== */

function log(message){

    const time =
        new Date().toLocaleTimeString();

    logs.textContent +=
        `[${time}] ${message}\n`;

    logs.scrollTop =
        logs.scrollHeight;
}


function setStatus(
    message,
    state = "waiting"
){

    statusText.textContent =
        message;

    statusDot.classList.remove(
        "connected",
        "waiting",
        "error"
    );

    statusDot.classList.add(
        state
    );
}


function formatBytes(bytes){

    if(bytes < 1024)
        return bytes + " B";

    if(bytes < 1024 ** 2)
        return (
            bytes / 1024
        ).toFixed(1) + " KB";

    if(bytes < 1024 ** 3)
        return (
            bytes / 1024 / 1024
        ).toFixed(1) + " MB";

    return (
        bytes /
        1024 /
        1024 /
        1024
    ).toFixed(2) + " GB";
}


function formatSpeed(value){

    return formatBytes(value) + "/s";
}


function cleanRoom(value){

    return String(value)
        .toUpperCase()
        .replace(
            /[^A-Z0-9]/g,
            ""
        )
        .slice(0,16);
}


function createRoomKey(){

    const chars =
        "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    let result = "";

    for(
        let i = 0;
        i < 6;
        i++
    ){

        result +=
            chars[
                Math.floor(
                    Math.random() *
                    chars.length
                )
            ];
    }

    return result;
}


function escapeHtml(value){

    return String(value)
        .replace(
            /&/g,
            "&amp;"
        )
        .replace(
            /</g,
            "&lt;"
        )
        .replace(
            />/g,
            "&gt;"
        )
        .replace(
            /"/g,
            "&quot;"
        )
        .replace(
            /'/g,
            "&#039;"
        );
}


/* ==========================================================
   UI
========================================================== */

function openApp(){

    roomCode.textContent =
        room;

    joinPage.classList.add(
        "hidden"
    );

    appPage.classList.remove(
        "hidden"
    );
}


function openJoin(){

    appPage.classList.add(
        "hidden"
    );

    joinPage.classList.remove(
        "hidden"
    );
}


function enableFileSharing(){

    dropZone.classList.remove(
        "disabled"
    );

    fileInput.disabled =
        false;
}


function disableFileSharing(){

    dropZone.classList.add(
        "disabled"
    );

    fileInput.disabled =
        true;
}


/* ==========================================================
   CREATE ROOM
========================================================== */

createButton.onclick =
async function(){

    if(socket)
        return;

    room =
        createRoomKey();

    isCreator =
        true;

    openApp();

    log(
        "Created room: " +
        room
    );

    await connectToSignaling();
};


/* ==========================================================
   JOIN ROOM
========================================================== */

joinButton.onclick =
async function(){
    const inputArea = document.getElementById("joinInputArea");
    if (inputArea && inputArea.style.display === "none") {
        inputArea.style.display = "block";
        document.getElementById("createButton").style.display = "none";
        return;
    }

    if(socket)
        return;

    room =
        cleanRoom(
            roomInput.value
        );

    if(!room){

        alert(
            "Please enter a valid room key."
        );

        return;
    }

    isCreator =
        false;

    openApp();

    log(
        "Joining room: " +
        room
    );

    await connectToSignaling();
};


/* ==========================================================
   SIGNALING CONNECTION
========================================================== */

async function connectToSignaling(){

    disableFileSharing();

    setStatus(
        "Connecting to signaling server...",
        "waiting"
    );

    const secured = await ensureQuickDropSecurity();
    if (!secured || !WS_URL) {
        setStatus("Signaling security error", "error");
        log("Failed to retrieve encrypted signaling credentials.");
        return;
    }

    const websocketUrl =
        WS_URL +
        "?room=" +
        encodeURIComponent(room);


    log(
        "Opening signaling connection..."
    );


    try{

        socket =
            new WebSocket(
                websocketUrl
            );

    }
    catch(error){

        log(
            "WebSocket creation failed: " +
            error.message
        );

        setStatus(
            "Unable to connect to signaling server",
            "error"
        );

        return;
    }


    socket.onopen =
    function(){

        log(
            "Connected to signaling server."
        );


        /*
         * Tell the Durable Object which room
         * we want.
         */

        socket.send(
            JSON.stringify({

                type:
                    "join",

                room:
                    room

            })
        );


        /*
         * Create peer connection BEFORE
         * peer-joined can arrive.
         */

        createPeerConnection();


        if(isCreator){

            setStatus(
                "Room created • Waiting for the other device...",
                "waiting"
            );

        }
        else{

            setStatus(
                "Joined room • Waiting for connection...",
                "waiting"
            );
        }
    };


    socket.onmessage =
    async function(event){

        try{

            const message =
                JSON.parse(
                    event.data
                );


            log(
                "Signal received: " +
                message.type
            );


            await handleSignalMessage(
                message
            );

        }
        catch(error){

            log(
                "Signal handling error: " +
                error.message
            );
        }
    };


    socket.onerror =
    function(){

        log(
            "WebSocket error."
        );


        if(!connected){

            setStatus(
                "Signaling error",
                "error"
            );
        }
    };


    socket.onclose =
    function(){

        log(
            "Signaling connection closed."
        );


        if(
            !connected &&
            !leaving
        ){

            setStatus(
                "Signaling disconnected",
                "error"
            );
        }
    };
}


/* ==========================================================
   CREATE RTCPeerConnection
========================================================== */

function createPeerConnection(){

    if(peer)
        return;


    peer =
        new RTCPeerConnection(
            RTC_CONFIG
        );


    /*
     * ICE candidates.
     */

    peer.onicecandidate =
    function(event){

        if(
            !event.candidate
        ){
            return;
        }


        sendSignal({

            type:
                "ice",

            candidate:
                event.candidate

        });
    };


    /*
     * Remote data channel.
     *
     * Only the creator creates it.
     * The receiver gets it here.
     */

    peer.ondatachannel =
    function(event){

        log(
            "Data channel received."
        );


        setupDataChannel(
            event.channel
        );
    };


    /*
     * Connection state.
     */

    peer.onconnectionstatechange =
    function(){

        const state =
            peer.connectionState;


        log(
            "Peer connection: " +
            state
        );


        if(
            state ===
            "connected"
        ){

            connected =
                true;

            enableFileSharing();


            setStatus(
                "Connected • Ready to share",
                "connected"
            );
        }


        if(
            state ===
            "disconnected"
        ){

            connected =
                false;

            disableFileSharing();


            setStatus(
                "Peer disconnected",
                "error"
            );
        }


        if(
            state ===
            "failed"
        ){

            connected =
                false;

            disableFileSharing();


            setStatus(
                "Peer connection failed",
                "error"
            );
        }


        if(
            state ===
            "closed"
        ){

            connected =
                false;

            disableFileSharing();
        }
    };


    /*
     * ICE state logging.
     */

    peer.oniceconnectionstatechange =
    function(){

        log(
            "ICE state: " +
            peer.iceConnectionState
        );
    };
}


/* ==========================================================
   DATA CHANNEL SETUP
========================================================== */

function setupDataChannel(channel){

    /*
     * Prevent an accidental duplicate channel.
     */

    if(
        dataChannel &&
        dataChannel !== channel &&
        dataChannel.readyState !==
        "closed"
    ){

        try{
            channel.close();
        }
        catch{}

        return;
    }


    dataChannel =
        channel;


    dataChannel.binaryType =
        "arraybuffer";


    dataChannel.bufferedAmountLowThreshold =
        LOW_WATER_MARK;


    dataChannel.onopen =
    function(){

        connected =
            true;

        enableFileSharing();


        setStatus(
            "Connected • Ready to share",
            "connected"
        );


        log(
            "File transfer channel is open."
        );
    };


    dataChannel.onclose =
    function(){

        connected =
            false;

        disableFileSharing();


        setStatus(
            "File transfer channel closed",
            "error"
        );


        log(
            "File transfer channel closed."
        );
    };


    dataChannel.onerror =
    function(error){

        console.error(
            error
        );

        log(
            "Data channel error."
        );
    };


    dataChannel.onmessage =
    async function(event){

        await handleDataMessage(
            event.data
        );
    };
}


/* ==========================================================
   SEND SIGNAL
========================================================== */

function sendSignal(data){

    if(
        !socket ||
        socket.readyState !==
        WebSocket.OPEN
    ){

        log(
            "Cannot send signal: WebSocket not open."
        );

        return;
    }


    socket.send(
        JSON.stringify({

            type:
                "signal",

            room:
                room,

            data:
                data

        })
    );
}


/* ==========================================================
   SIGNAL HANDLER
========================================================== */

async function handleSignalMessage(
    message
){

    /*
     * Room information.
     */

    if(
        message.type ===
        "joined"
    ){

        log(
            "Joined room. Peers: " +
            message.peerCount
        );


        /*
         * If creator somehow sees two peers
         * in the initial joined response,
         * start negotiation.
         */

        if(
            isCreator &&
            message.peerCount === 2 &&
            !offerSent
        ){

            peerJoined =
                true;

            await createOffer();
        }


        return;
    }


    /*
     * Second device entered the room.
     */

    if(
        message.type ===
        "peer-joined"
    ){

        log(
            "Other device joined the room."
        );


        peerJoined =
            true;


        /*
         * ONLY CREATOR sends the offer.
         *
         * We explicitly do NOT use
         * onnegotiationneeded.
         */

        if(
            isCreator &&
            !offerSent
        ){

            await createOffer();
        }


        return;
    }


    /*
     * Room full.
     */

    if(
        message.type ===
        "room-full"
    ){

        setStatus(
            "Room is full",
            "error"
        );


        alert(
            "This room already has two devices."
        );


        return;
    }


    /*
     * Peer left.
     */

    if(
        message.type ===
        "peer-left"
    ){

        connected =
            false;

        peerJoined =
            false;

        offerSent =
            false;

        receivedOffer =
            false;

        disableFileSharing();


        setStatus(
            "Other device left the room",
            "waiting"
        );


        log(
            "Other device left."
        );


        return;
    }


    /*
     * The Worker forwards our wrapper:
     *
     * {
     *   type:"signal",
     *   room:"...",
     *   data:{...}
     * }
     *
     * Unwrap it.
     */

    if(
        message.type ===
        "signal"
    ){

        if(
            !message.data
        ){
            return;
        }


        message =
            message.data;
    }


    /*
     ========================================================
     OFFER
     ========================================================
    */

    if(
        message.type ===
        "offer"
    ){

        const description =
            message.description ||
            message.offer;


        if(
            !description
        ){
            return;
        }


        /*
         * Receiver should only accept ONE offer.
         */

        if(
            receivedOffer
        ){

            log(
                "Duplicate offer ignored."
            );

            return;
        }


        /*
         * If this isn't the receiver,
         * ignore it.
         */

        if(
            isCreator
        ){

            log(
                "Creator ignored incoming offer."
            );

            return;
        }


        /*
         * We must be stable before accepting
         * the first offer.
         */

        if(
            peer.signalingState !==
            "stable"
        ){

            log(
                "Offer ignored because peer state is " +
                peer.signalingState
            );

            return;
        }


        receivedOffer =
            true;


        try{

            await peer.setRemoteDescription(
                description
            );


            await flushPendingCandidates();


            const answer =
                await peer.createAnswer();


            await peer.setLocalDescription(
                answer
            );


            sendSignal({

                type:
                    "answer",

                description:
                    peer.localDescription

            });


            log(
                "Answer sent."
            );

        }
        catch(error){

            receivedOffer =
                false;


            log(
                "Offer error: " +
                error.message
            );
        }


        return;
    }


    /*
     ========================================================
     ANSWER
     ========================================================
    */

    if(
        message.type ===
        "answer"
    ){

        const description =
            message.description ||
            message.answer;


        if(
            !description
        ){
            return;
        }


        /*
         * ONLY creator should receive the answer.
         */

        if(
            !isCreator
        ){

            log(
                "Receiver ignored incoming answer."
            );

            return;
        }


        /*
         * This check is the main protection
         * against:
         *
         * Called in wrong state: stable
         */

        if(
            peer.signalingState !==
            "have-local-offer"
        ){

            log(
                "Duplicate/stale answer ignored. State: " +
                peer.signalingState
            );

            return;
        }


        try{

            await peer.setRemoteDescription(
                description
            );


            await flushPendingCandidates();


            log(
                "Answer accepted."
            );

        }
        catch(error){

            log(
                "Answer error: " +
                error.message
            );
        }


        return;
    }


    /*
     ========================================================
     ICE
     ========================================================
    */

    if(
        message.type ===
        "ice"
    ){

        if(
            !message.candidate
        ){
            return;
        }


        /*
         * If remote SDP isn't installed yet,
         * queue the candidate.
         */

        if(
            !peer.remoteDescription
        ){

            pendingCandidates.push(
                message.candidate
            );

            return;
        }


        try{

            await peer.addIceCandidate(
                message.candidate
            );

        }
        catch(error){

            log(
                "ICE candidate error: " +
                error.message
            );
        }


        return;
    }
}


/* ==========================================================
   CREATE OFFER
========================================================== */

async function createOffer(){

    /*
     * Only creator.
     */

    if(!isCreator)
        return;


    /*
     * Must have second peer.
     */

    if(!peerJoined)
        return;


    /*
     * Never create second offer.
     */

    if(offerSent)
        return;


    /*
     * Must be stable.
     */

    if(
        peer.signalingState !==
        "stable"
    ){

        log(
            "Cannot create offer. Current state: " +
            peer.signalingState
        );

        return;
    }


    /*
     * Prevent duplicate calls.
     */

    offerSent =
        true;


    try{

        /*
         * Creator creates the ONLY data channel.
         */

        if(
            !dataChannel ||
            dataChannel.readyState ===
            "closed"
        ){

            const channel =
                peer.createDataChannel(
                    "files",
                    {
                        ordered:true
                    }
                );


            setupDataChannel(
                channel
            );
        }


        /*
         * Give the browser a tiny amount of time
         * to register the DataChannel.
         */

        await wait(100);


        /*
         * Create exactly one offer.
         */

        const offer =
            await peer.createOffer();


        await peer.setLocalDescription(
            offer
        );


        /*
         * Send offer.
         */

        sendSignal({

            type:
                "offer",

            description:
                peer.localDescription

        });


        log(
            "Offer sent."
        );

    }
    catch(error){

        offerSent =
            false;


        log(
            "Offer creation error: " +
            error.message
        );
    }
}


/* ==========================================================
   WAIT
========================================================== */

function wait(ms){

    return new Promise(
        resolve =>
            setTimeout(
                resolve,
                ms
            )
    );
}


/* ==========================================================
   FLUSH ICE
========================================================== */

async function flushPendingCandidates(){

    if(
        !peer.remoteDescription
    ){
        return;
    }


    const list =
        pendingCandidates.splice(
            0
        );


    for(
        const candidate of
        list
    ){

        try{

            await peer.addIceCandidate(
                candidate
            );

        }
        catch(error){

            log(
                "Queued ICE error: " +
                error.message
            );
        }
    }
}


/* ==========================================================
   FILE PICKER
========================================================== */

fileInput.onchange =
function(event){

    if(
        !connected ||
        !dataChannel ||
        dataChannel.readyState !==
        "open"
    ){

        alert(
            "Wait until both devices show Connected."
        );

        return;
    }


    const files =
        [...event.target.files];


    sendFiles(
        files
    );


    fileInput.value =
        "";
};


/* ==========================================================
   DRAG AND DROP
========================================================== */

dropZone.ondragover =
function(event){

    event.preventDefault();

    if(
        !connected
    ){
        return;
    }


    dropZone.classList.add(
        "drag"
    );
};


dropZone.ondragleave =
function(){

    dropZone.classList.remove(
        "drag"
    );
};


dropZone.ondrop =
function(event){

    event.preventDefault();

    dropZone.classList.remove(
        "drag"
    );


    if(
        !connected
    ){

        alert(
            "Wait until both devices are connected."
        );

        return;
    }


    const files =
        [...event.dataTransfer.files];


    sendFiles(
        files
    );
};


/* ==========================================================
   TRANSFER UI
========================================================== */

function createTransferUI(
    name,
    size
){

    const element =
        document.createElement(
            "div"
        );


    element.className =
        "transfer";


    element.innerHTML = `

        <div class="transferTop">

            <div>

                <div class="filename">
                    ${escapeHtml(name)}
                </div>

                <div class="filemeta">
                    ${formatBytes(size)}
                </div>

            </div>

            <strong class="percent">
                0%
            </strong>

        </div>

        <div class="progress">

            <div
                class="progressBar"
            ></div>

        </div>

        <div class="transferBottom">

            <span class="speed">
                Waiting...
            </span>

            <span class="count">
                0 B / ${formatBytes(size)}
            </span>

        </div>
    `;


    transfers.prepend(
        element
    );


    return element;
}


function updateTransfer(
    element,
    percent,
    transferred,
    total,
    currentSpeed,
    complete = false
){

    const bar =
        element.querySelector(
            ".progressBar"
        );


    const percentage =
        element.querySelector(
            ".percent"
        );


    const speedElement =
        element.querySelector(
            ".speed"
        );


    const count =
        element.querySelector(
            ".count"
        );


    bar.style.width =
        percent + "%";


    percentage.textContent =
        Math.round(percent) + "%";


    count.textContent =
        formatBytes(
            transferred
        ) +
        " / " +
        formatBytes(
            total
        );


    speedElement.textContent =
        complete
            ? "Complete"
            : currentSpeed > 0
                ? formatSpeed(
                    currentSpeed
                )
                : "Transferring...";
}


/* ==========================================================
   SEND FILES
========================================================== */

async function sendFiles(files){

    if(
        !connected ||
        !dataChannel ||
        dataChannel.readyState !==
        "open"
    ){

        alert(
            "The other device is not connected yet."
        );

        return;
    }


    for(
        const file of
        files
    ){

        await sendFile(
            file
        );
    }
}


/* ==========================================================
   SEND FILE
========================================================== */

async function sendFile(file){

    const ui =
        createTransferUI(
            file.name,
            file.size
        );


    const startTime =
        performance.now();


    let offset =
        0;


    let lastUpdate =
        performance.now();


    /*
     * File metadata.
     */

    dataChannel.send(
        JSON.stringify({

            type:
                "file-start",

            name:
                file.name,

            size:
                file.size,

            mime:
                file.type ||
                "application/octet-stream"

        })
    );


    /*
     * Send chunks.
     */

    while(
        offset <
        file.size
    ){

        /*
         * Don't overflow browser memory.
         */

        if(
            dataChannel.bufferedAmount >
            HIGH_WATER_MARK
        ){

            await waitForBuffer();
        }


        const chunk =
            file.slice(
                offset,
                offset + CHUNK_SIZE
            );


        const buffer =
            await chunk.arrayBuffer();


        dataChannel.send(
            buffer
        );


        offset +=
            buffer.byteLength;


        const now =
            performance.now();


        if(
            now -
            lastUpdate >
            100
        ){

            const elapsed =
                (
                    now -
                    startTime
                ) / 1000;


            const currentSpeed =
                elapsed > 0
                    ? offset / elapsed
                    : 0;


            const percent =
                file.size === 0
                    ? 100
                    : (
                        offset /
                        file.size
                    ) * 100;


            updateTransfer(
                ui,
                percent,
                offset,
                file.size,
                currentSpeed
            );


            lastUpdate =
                now;
        }
    }


    /*
     * Tell receiver the file is complete.
     */

    dataChannel.send(
        JSON.stringify({

            type:
                "file-end"

        })
    );


    updateTransfer(
        ui,
        100,
        file.size,
        file.size,
        0,
        true
    );


    log(
        "File sent successfully: " +
        file.name
    );
}


/* ==========================================================
   WAIT FOR BUFFER
========================================================== */

function waitForBuffer(){

    return new Promise(
        resolve => {

            if(
                !dataChannel ||
                dataChannel.readyState !==
                "open"
            ){

                resolve();

                return;
            }


            const check =
                function(){

                    if(
                        !dataChannel ||
                        dataChannel.readyState !==
                        "open"
                    ){

                        resolve();

                        return;
                    }


                    if(
                        dataChannel.bufferedAmount <=
                        LOW_WATER_MARK
                    ){

                        resolve();

                        return;
                    }


                    setTimeout(
                        check,
                        30
                    );
                };


            check();
        }
    );
}


/* ==========================================================
   RECEIVE DATA
========================================================== */

async function handleDataMessage(
    data
){

    /*
     * Control messages are text.
     */

    if(
        typeof data ===
        "string"
    ){

        let message;


        try{

            message =
                JSON.parse(
                    data
                );

        }
        catch{

            return;
        }


        /*
         * New file.
         */

        if(
            message.type ===
            "file-start"
        ){

            const ui =
                createTransferUI(
                    message.name,
                    message.size
                );


            incomingFile = {

                name:
                    message.name,

                size:
                    message.size,

                mime:
                    message.mime ||
                    "application/octet-stream",

                chunks:
                    [],

                received:
                    0,

                started:
                    performance.now(),

                ui:
                    ui

            };


            log(
                "Receiving file: " +
                message.name
            );


            return;
        }


        /*
         * Finished file.
         */

        if(
            message.type ===
            "file-end"
        ){

            finishIncomingFile();

            return;
        }


        return;
    }


    /*
     * Binary chunk.
     */

    if(
        data instanceof ArrayBuffer
    ){

        receiveChunk(
            data
        );

        return;
    }


    /*
     * Blob fallback.
     */

    if(
        data instanceof Blob
    ){

        const buffer =
            await data.arrayBuffer();


        receiveChunk(
            buffer
        );
    }
}


/* ==========================================================
   RECEIVE CHUNK
========================================================== */

function receiveChunk(
    buffer
){

    if(
        !incomingFile
    ){

        return;
    }


    incomingFile.chunks.push(
        buffer
    );


    incomingFile.received +=
        buffer.byteLength;


    const elapsed =
        (
            performance.now() -
            incomingFile.started
        ) / 1000;


    const currentSpeed =
        elapsed > 0
            ? incomingFile.received /
              elapsed
            : 0;


    const percent =
        incomingFile.size === 0
            ? 100
            : (
                incomingFile.received /
                incomingFile.size
            ) * 100;


    updateTransfer(
        incomingFile.ui,
        percent,
        incomingFile.received,
        incomingFile.size,
        currentSpeed
    );
}


/* ==========================================================
   FINISH RECEIVED FILE
========================================================== */

function finishIncomingFile(){

    if(
        !incomingFile
    ){

        return;
    }


    /*
     * Verify the size.
     */

    if(
        incomingFile.received !==
        incomingFile.size
    ){

        log(
            "ERROR: Received size does not match."
        );


        incomingFile =
            null;


        return;
    }


    /*
     * Build Blob.
     */

    const blob =
        new Blob(
            incomingFile.chunks,
            {
                type:
                    incomingFile.mime
            }
        );


    /*
     * Create persistent object URL.
     */

    const url =
        URL.createObjectURL(
            blob
        );


    const name =
        incomingFile.name;


    /*
     * Create real download link.
     *
     * This is much more reliable than only
     * calling link.click().
     */

    const downloadLink =
        document.createElement(
            "a"
        );


    downloadLink.className =
        "downloadLink";


    downloadLink.href =
        url;


    downloadLink.download =
        name;


    downloadLink.rel =
        "noopener";


    downloadLink.textContent =
        "⬇ Download File";


    /*
     * Open fallback.
     */

    const openLink =
        document.createElement(
            "a"
        );


    openLink.className =
        "openLink";


    openLink.href =
        url;


    openLink.target =
        "_blank";


    openLink.rel =
        "noopener";


    openLink.textContent =
        "↗ Open File";


    /*
     * Button area.
     */

    const downloadArea =
        document.createElement(
            "div"
        );


    downloadArea.className =
        "downloadArea";


    downloadArea.appendChild(
        downloadLink
    );


    downloadArea.appendChild(
        openLink
    );


    /*
     * Mobile instructions.
     */

    const info =
        document.createElement(
            "div"
        );


    info.className =
        "info";


    info.textContent =
        "On iPhone/iPad, use Open File if Download File does not save automatically. From the opened file, use Share → Save to Files.";
    

    downloadArea.appendChild(
        info
    );


    incomingFile.ui.appendChild(
        downloadArea
    );


    updateTransfer(
        incomingFile.ui,
        100,
        incomingFile.size,
        incomingFile.size,
        0,
        true
    );


    log(
        "File received successfully: " +
        name
    );


    /*
     * Keep the object URL alive for 30 minutes.
     */

    setTimeout(
        function(){

            URL.revokeObjectURL(
                url
            );

        },
        30 * 60 * 1000
    );


    incomingFile =
        null;
}


/* ==========================================================
   COPY ROOM
========================================================== */

copyButton.onclick =
async function(){

    try{

        await navigator.clipboard.writeText(
            room
        );


        copyButton.textContent =
            "Copied!";


        setTimeout(
            function(){

                copyButton.textContent =
                    "Copy";

            },
            1200
        );

    }
    catch{

        prompt(
            "Copy this room key:",
            room
        );
    }
};


/* ==========================================================
   LEAVE ROOM
========================================================== */

leaveButton.onclick =
function(){

    leaving =
        true;


    try{

        if(dataChannel)
            dataChannel.close();

    }
    catch{}


    try{

        if(peer)
            peer.close();

    }
    catch{}


    try{

        if(socket)
            socket.close();

    }
    catch{}


    dataChannel =
        null;

    peer =
        null;

    socket =
        null;

    peerJoined =
        false;

    offerSent =
        false;

    receivedOffer =
        false;

    connected =
        false;

    pendingCandidates =
        [];

    incomingFile =
        null;

    room =
        "";

    isCreator =
        false;

    transfers.innerHTML =
        "";

    logs.textContent =
        "";

    roomInput.value =
        "";

    disableFileSharing();

    openJoin();

    setStatus(
        "Disconnected",
        "waiting"
    );


    leaving =
        false;
};


/* ==========================================================
   ENTER KEY
========================================================== */

roomInput.onkeydown =
function(event){

    if(
        event.key ===
        "Enter"
    ){

        joinButton.click();
    }
};


/* ==========================================================
   OPTIONAL ROOM FROM URL
========================================================== */

(function(){

    const params =
        new URLSearchParams(
            window.location.search
        );


    const existingRoom =
        cleanRoom(
            params.get("room") || ""
        );


    if(existingRoom){

        roomInput.value =
            existingRoom;
    }

})();


})();