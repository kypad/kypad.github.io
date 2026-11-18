/**
 * QuickDrop - Universal Cross-Network File Transfer Engine
 * Powered by Kypad Hybrid Multi-Transport Architecture
 * 
 * Features:
 * - Direct WebRTC P2P DataChannel (fastest for LAN / local Wi-Fi)
 * - Cloudflare Edge Relay Fail-Safe (guaranteed transfer across mobile hotspots,
 *   different cellular carriers, corporate/university firewalls, and symmetric NAT)
 * - Zero-Configuration Seamless Fallback: Transfer is instantly ready upon joining
 * - Screen WakeLock API for mobile devices
 * - Keep-alive Heartbeat preventing mobile carrier TCP timeouts
 * - Chunk-level backpressure control
 * - One-click Shareable Link & QR Code generator for effortless mobile pairing
 * - Instant auto-join via URL query parameter (?room=...)
 */
(() => {
    "use strict";

    /* ==========================================================
       CONSTANTS & CONFIGURATION
    ========================================================== */
    const CHUNK_SIZE = 64 * 1024; // 64 KB per chunk
    const HIGH_WATER_MARK = CHUNK_SIZE * 16;
    const LOW_WATER_MARK = CHUNK_SIZE * 8;
    const WS_HIGH_WATER_MARK = 256 * 1024;
    const WS_LOW_WATER_MARK = 64 * 1024;
    const HEARTBEAT_INTERVAL_MS = 15000;

    let WS_URL = "";
    let RTC_CONFIG = null;

    async function ensureQuickDropSecurity() {
        if (WS_URL && RTC_CONFIG) return true;
        try {
            const config = await window.SecurityVault.getQuickDropConfig();
            WS_URL = config.wsUrl;
            // High-reliability STUN servers with sub-100ms response
            RTC_CONFIG = {
                iceServers: [
                    { urls: "stun:stun.l.google.com:19302" },
                    { urls: "stun:stun1.l.google.com:19302" },
                    { urls: "stun:stun2.l.google.com:19302" },
                    { urls: "stun:stun.cloudflare.com:3478" }
                ]
            };
            return true;
        } catch (err) {
            console.error("Security Vault decryption failed:", err);
            return false;
        }
    }

    /* ==========================================================
       DOM REFERENCES
    ========================================================== */
    const joinPage = document.getElementById("joinPage");
    const appPage = document.getElementById("appPage");
    const joinInputArea = document.getElementById("joinInputArea");
    const roomInput = document.getElementById("roomInput");
    const createButton = document.getElementById("createButton");
    const joinButton = document.getElementById("joinButton");

    const roomCode = document.getElementById("roomCode");
    const copyButton = document.getElementById("copyButton");
    const copyLinkButton = document.getElementById("copyLinkButton");
    const qrButton = document.getElementById("qrButton");
    const qrCard = document.getElementById("qrCard");
    const qrImg = document.getElementById("qrImg");

    const statusText = document.getElementById("statusText");
    const statusDot = document.getElementById("statusDot");
    const transportBadge = document.getElementById("transportBadge");

    const fileInput = document.getElementById("fileInput");
    const dropZone = document.getElementById("dropZone");
    const transfers = document.getElementById("transfers");
    const logs = document.getElementById("logs");
    const leaveButton = document.getElementById("leaveButton");
    const transferEngineNode = document.getElementById("transferEngineNode");

    /* ==========================================================
       APPLICATION STATE
    ========================================================== */
    let room = "";
    let isCreator = false;
    let socket = null;
    let peer = null;
    let dataChannel = null;

    let peerJoined = false;
    let webrtcConnected = false;
    let activeTransport = null; // "webrtc" | "relay" | null
    let offerSent = false;
    let receivedOffer = false;
    let leaving = false;

    let pendingCandidates = [];
    let incomingFile = null;
    let isSending = false;
    let outgoingQueue = [];

    let wakeLockSentinel = null;
    let heartbeatTimer = null;
    let p2pNegotiationTimer = null;

    /* ==========================================================
       LOGGING & STATUS HELPERS
    ========================================================== */
    function log(message) {
        const time = new Date().toLocaleTimeString();
        if (logs) {
            logs.textContent += `[${time}] ${message}\n`;
            logs.scrollTop = logs.scrollHeight;
        }
        console.log(`[QuickDrop ${time}]`, message);
    }

    function setStatus(message, state = "waiting") {
        if (!statusText || !statusDot) return;
        statusText.textContent = message;
        statusDot.className = "dot " + state;
    }

    function updateTransportBadge(mode) {
        if (!transportBadge) return;
        transportBadge.classList.remove("hidden", "p2p", "relay");

        if (mode === "webrtc") {
            transportBadge.textContent = "⚡ Direct P2P (Ultra Fast)";
            transportBadge.classList.add("p2p");
            if (transferEngineNode) {
                transferEngineNode.textContent = "WebRTC Direct P2P (Local Speed)";
            }
        } else if (mode === "relay") {
            transportBadge.textContent = "🔒 Cloudflare Edge Relay (Universal)";
            transportBadge.classList.add("relay");
            if (transferEngineNode) {
                transferEngineNode.textContent = "Cloudflare Edge Relay (Cross-Network Active)";
            }
        } else {
            transportBadge.textContent = "Negotiating...";
            transportBadge.classList.add("hidden");
        }
    }

    function formatBytes(bytes) {
        if (bytes === 0) return "0 B";
        const units = ["B", "KB", "MB", "GB", "TB"];
        const k = 1024;
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return (bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 2) + " " + units[i];
    }

    function formatSpeed(bytesPerSec) {
        return formatBytes(bytesPerSec) + "/s";
    }

    function cleanRoom(value) {
        return (value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    }

    function createRoomKey() {
        const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        let out = "";
        for (let i = 0; i < 6; i++) {
            out += chars[Math.floor(Math.random() * chars.length)];
        }
        return out;
    }

    function escapeHtml(value) {
        return (value || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function getRoomShareUrl() {
        const url = new URL(window.location.href);
        url.search = "?room=" + encodeURIComponent(room);
        return url.toString();
    }

    /* ==========================================================
       MOBILE SCREEN WAKELOCK
    ========================================================== */
    async function requestWakeLock() {
        try {
            if ("wakeLock" in navigator && !wakeLockSentinel) {
                wakeLockSentinel = await navigator.wakeLock.request("screen");
                wakeLockSentinel.addEventListener("release", () => {
                    wakeLockSentinel = null;
                });
            }
        } catch (_) {}
    }

    function releaseWakeLock() {
        try {
            if (wakeLockSentinel) {
                wakeLockSentinel.release();
                wakeLockSentinel = null;
            }
        } catch (_) {}
    }

    /* ==========================================================
       VIEW ORCHESTRATION
    ========================================================== */
    function openApp() {
        joinPage.classList.add("hidden");
        appPage.classList.remove("hidden");
        roomCode.textContent = room;
        updateQrCode();
    }

    function openJoin() {
        appPage.classList.add("hidden");
        joinPage.classList.remove("hidden");
        if (joinInputArea) joinInputArea.style.display = "none";
        if (createButton) createButton.style.display = "";
        if (qrCard) qrCard.classList.add("hidden");
    }

    function enableFileSharing() {
        dropZone.classList.remove("disabled");
        fileInput.disabled = false;
    }

    function disableFileSharing() {
        dropZone.classList.add("disabled");
        fileInput.disabled = true;
    }

    function updateQrCode() {
        if (!room || !qrImg) return;
        const shareUrl = getRoomShareUrl();
        qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=8&data=${encodeURIComponent(shareUrl)}`;
    }

    /* ==========================================================
       TRANSPORT RESOLUTION
    ========================================================== */
    function getActiveTransport() {
        if (dataChannel && dataChannel.readyState === "open") {
            return "webrtc";
        }
        if (socket && socket.readyState === WebSocket.OPEN && peerJoined) {
            return "relay";
        }
        return null;
    }

    function refreshTransport() {
        const transport = getActiveTransport();
        activeTransport = transport;

        if (transport === "webrtc") {
            setStatus("Connected • Ready to share", "connected");
            updateTransportBadge("webrtc");
            enableFileSharing();
        } else if (transport === "relay") {
            setStatus("Connected • Ready to share", "connected");
            updateTransportBadge("relay");
            enableFileSharing();
        } else if (peerJoined) {
            setStatus("Connected • Establishing transport...", "waiting");
            updateTransportBadge(null);
            enableFileSharing();
        } else {
            disableFileSharing();
            updateTransportBadge(null);
            if (isCreator) {
                setStatus("Room created • Waiting for other device...", "waiting");
            } else {
                setStatus("Joined room • Waiting for other device...", "waiting");
            }
        }
    }

    /* ==========================================================
       SENDING DATA / CONTROL MESSAGES
    ========================================================== */
    function sendSignal(data) {
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            log("Cannot send signal: WebSocket not open.");
            return;
        }
        socket.send(JSON.stringify({
            type: "signal",
            room: room,
            data: data
        }));
    }

    function sendControlMessage(msg, transport) {
        if (transport === "webrtc" && dataChannel && dataChannel.readyState === "open") {
            dataChannel.send(JSON.stringify(msg));
        } else if (socket && socket.readyState === WebSocket.OPEN) {
            sendSignal(msg);
        } else {
            throw new Error("No active transport available to send control message.");
        }
    }

    /* ==========================================================
       SIGNALING CONNECTION & HEARTBEAT
    ========================================================== */
    async function connectToSignaling() {
        disableFileSharing();
        setStatus("Connecting to signaling server...", "waiting");

        const secured = await ensureQuickDropSecurity();
        if (!secured || !WS_URL) {
            setStatus("Signaling security error", "error");
            log("Failed to retrieve encrypted signaling credentials.");
            return;
        }

        const websocketUrl = WS_URL + "?room=" + encodeURIComponent(room);
        log("Opening signaling connection to Cloudflare Edge...");

        try {
            socket = new WebSocket(websocketUrl);
            socket.binaryType = "arraybuffer";
        } catch (error) {
            log("WebSocket creation failed: " + error.message);
            setStatus("Unable to connect to signaling server", "error");
            return;
        }

        socket.onopen = function () {
            log("Connected to Cloudflare Edge signaling server.");

            // Request room registration
            socket.send(JSON.stringify({
                type: "join",
                room: room
            }));

            // Start heartbeat to prevent mobile carrier TCP timeout
            clearInterval(heartbeatTimer);
            heartbeatTimer = setInterval(() => {
                if (socket && socket.readyState === WebSocket.OPEN && room) {
                    socket.send(JSON.stringify({
                        type: "signal",
                        room: room,
                        data: { type: "heartbeat" }
                    }));
                }
            }, HEARTBEAT_INTERVAL_MS);

            // Initiate peer connection
            createPeerConnection();

            if (isCreator) {
                setStatus("Room created • Waiting for the other device...", "waiting");
            } else {
                setStatus("Joined room • Waiting for connection...", "waiting");
            }
        };

        socket.onmessage = async function (event) {
            // Handle binary chunk received via Edge Relay
            if (event.data instanceof ArrayBuffer) {
                receiveChunk(event.data);
                return;
            }
            if (event.data instanceof Blob) {
                const buffer = await event.data.arrayBuffer();
                receiveChunk(buffer);
                return;
            }

            // Handle text / JSON message
            try {
                const message = JSON.parse(event.data);
                await handleSignalMessage(message);
            } catch (error) {
                log("Signal handling error: " + error.message);
            }
        };

        socket.onerror = function () {
            log("Signaling WebSocket error.");
            if (!peerJoined) {
                setStatus("Signaling error", "error");
            }
        };

        socket.onclose = function () {
            log("Signaling connection closed.");
            clearInterval(heartbeatTimer);
            if (!leaving && !webrtcConnected) {
                peerJoined = false;
                refreshTransport();
                setStatus("Signaling disconnected", "error");
            }
        };
    }

    /* ==========================================================
       CREATE RTCPeerConnection (WEBRTC)
    ========================================================== */
    function createPeerConnection() {
        if (peer) return;

        peer = new RTCPeerConnection(RTC_CONFIG);

        // Gather ICE candidates
        peer.onicecandidate = function (event) {
            if (!event.candidate) return;
            sendSignal({
                type: "ice",
                candidate: event.candidate
            });
        };

        // Incoming DataChannel (for joiner)
        peer.ondatachannel = function (event) {
            log("WebRTC DataChannel received from remote peer.");
            setupDataChannel(event.channel);
        };

        // Track peer connection state
        peer.onconnectionstatechange = function () {
            const state = peer.connectionState;
            log("WebRTC Peer state: " + state);

            if (state === "connected") {
                log("WebRTC P2P direct link established.");
            } else if (state === "disconnected" || state === "failed") {
                webrtcConnected = false;
                log("WebRTC direct link failed/disconnected. Cloudflare Edge Relay remains active.");
                refreshTransport();
            }
        };

        peer.oniceconnectionstatechange = function () {
            log("ICE state: " + peer.iceConnectionState);
        };
    }

    /* ==========================================================
       SETUP DATA CHANNEL
    ========================================================== */
    function setupDataChannel(channel) {
        if (dataChannel && dataChannel !== channel && dataChannel.readyState !== "closed") {
            try { channel.close(); } catch (_) {}
            return;
        }

        dataChannel = channel;
        dataChannel.binaryType = "arraybuffer";
        dataChannel.bufferedAmountLowThreshold = LOW_WATER_MARK;

        dataChannel.onopen = function () {
            webrtcConnected = true;
            log("WebRTC DataChannel open! Promoted to Direct P2P transfer.");
            clearTimeout(p2pNegotiationTimer);
            refreshTransport();
        };

        dataChannel.onclose = function () {
            webrtcConnected = false;
            log("WebRTC DataChannel closed. Falling back to Cloudflare Edge Relay.");
            refreshTransport();
        };

        dataChannel.onerror = function (err) {
            log("WebRTC DataChannel error: " + (err.message || "Unknown error"));
        };

        dataChannel.onmessage = async function (event) {
            if (event.data instanceof ArrayBuffer) {
                receiveChunk(event.data);
                return;
            }
            if (event.data instanceof Blob) {
                const buffer = await event.data.arrayBuffer();
                receiveChunk(buffer);
                return;
            }
            try {
                const msg = JSON.parse(event.data);
                handleDataControlMessage(msg);
            } catch (e) {
                log("DataChannel message parse error: " + e.message);
            }
        };
    }

    /* ==========================================================
       SIGNALING MESSAGE HANDLER
    ========================================================== */
    async function handleSignalMessage(message) {
        // Room status info
        if (message.type === "joined") {
            log("Joined room. Connected peers: " + message.peerCount);
            if (message.peerCount === 2) {
                onPeersConnected();
            }
            return;
        }

        // Another device joined the room
        if (message.type === "peer-joined") {
            log("Other device entered the room!");
            onPeersConnected();
            return;
        }

        // Room is full
        if (message.type === "room-full") {
            setStatus("Room is full", "error");
            alert("This room already has two devices connected.");
            return;
        }

        // Peer left
        if (message.type === "peer-left") {
            log("Other device left the room.");
            peerJoined = false;
            webrtcConnected = false;
            offerSent = false;
            receivedOffer = false;
            pendingCandidates = [];

            if (incomingFile) {
                log("Incoming transfer aborted because remote peer disconnected.");
                incomingFile = null;
            }

            refreshTransport();
            setStatus("Other device left the room", "waiting");
            return;
        }

        // Unwrap signal wrapper forwarded by worker
        if (message.type === "signal" && message.data) {
            message = message.data;
        }

        // Keep-alive heartbeat
        if (message.type === "heartbeat") {
            return;
        }

        // File transfer control messages relayed via Edge Relay
        if (message.type === "file-start" || message.type === "file-end") {
            handleDataControlMessage(message);
            return;
        }

        // WebRTC Offer
        if (message.type === "offer") {
            const description = message.description || message.offer;
            if (!description || receivedOffer || isCreator) return;

            if (peer.signalingState !== "stable") {
                log("Offer ignored because peer state is " + peer.signalingState);
                return;
            }

            receivedOffer = true;
            try {
                await peer.setRemoteDescription(description);
                await flushPendingCandidates();
                const answer = await peer.createAnswer();
                await peer.setLocalDescription(answer);
                sendSignal({
                    type: "answer",
                    description: peer.localDescription
                });
                log("WebRTC Answer sent.");
            } catch (error) {
                receivedOffer = false;
                log("Offer error: " + error.message);
            }
            return;
        }

        // WebRTC Answer
        if (message.type === "answer") {
            const description = message.description || message.answer;
            if (!description || !isCreator) return;

            if (peer.signalingState !== "have-local-offer") {
                log("Duplicate/stale answer ignored. State: " + peer.signalingState);
                return;
            }

            try {
                await peer.setRemoteDescription(description);
                await flushPendingCandidates();
                log("WebRTC Answer accepted.");
            } catch (error) {
                log("Answer error: " + error.message);
            }
            return;
        }

        // WebRTC ICE Candidate
        if (message.type === "ice") {
            if (!message.candidate) return;

            if (!peer || !peer.remoteDescription) {
                pendingCandidates.push(message.candidate);
                return;
            }

            try {
                await peer.addIceCandidate(message.candidate);
            } catch (error) {
                log("ICE candidate error: " + error.message);
            }
            return;
        }
    }

    /* ==========================================================
       PEERS CONNECTED HANDLER (UNIVERSAL HYBRID READY)
    ========================================================== */
    function onPeersConnected() {
        peerJoined = true;
        log("Both devices connected to room. Ready for cross-network transfer.");

        // Immediately enable universal transfer over Edge Relay
        refreshTransport();

        // Creator attempts WebRTC P2P direct negotiation in parallel
        if (isCreator && !offerSent) {
            createOffer();
        }

        // Allow 3.5 seconds for WebRTC direct P2P. If it doesn't open (e.g. mobile hotspot NAT),
        // confirm Edge Relay as the active transport smoothly without any user interruption.
        clearTimeout(p2pNegotiationTimer);
        p2pNegotiationTimer = setTimeout(() => {
            if (!webrtcConnected && peerJoined) {
                log("Universal Cloudflare Edge Relay is active (Cross-network mode).");
                refreshTransport();
            }
        }, 3500);
    }

    /* ==========================================================
       CREATE OFFER (CREATOR)
    ========================================================== */
    async function createOffer() {
        if (!isCreator || !peerJoined || offerSent) return;

        if (peer.signalingState !== "stable") {
            log("Cannot create offer: state is " + peer.signalingState);
            return;
        }

        offerSent = true;
        try {
            if (!dataChannel || dataChannel.readyState === "closed") {
                const channel = peer.createDataChannel("files", { ordered: true });
                setupDataChannel(channel);
            }

            await wait(80);
            const offer = await peer.createOffer();
            await peer.setLocalDescription(offer);

            sendSignal({
                type: "offer",
                description: peer.localDescription
            });

            log("WebRTC Offer created and sent.");
        } catch (error) {
            offerSent = false;
            log("Offer creation error: " + error.message);
        }
    }

    async function flushPendingCandidates() {
        if (!peer || !peer.remoteDescription) return;
        const candidates = [...pendingCandidates];
        pendingCandidates = [];

        for (const candidate of candidates) {
            try {
                await peer.addIceCandidate(candidate);
            } catch (error) {
                log("Pending ICE error: " + error.message);
            }
        }
    }

    function wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /* ==========================================================
       TRANSFER UI CREATION & PROGRESS
    ========================================================== */
    function createTransferUI(name, size) {
        const element = document.createElement("div");
        element.className = "transfer";
        element.innerHTML = `
            <div class="transferTop">
                <div>
                    <div class="filename">${escapeHtml(name)}</div>
                    <div class="filemeta">${formatBytes(size)}</div>
                </div>
                <strong class="percent">0%</strong>
            </div>
            <div class="progress">
                <div class="progressBar"></div>
            </div>
            <div class="transferBottom">
                <span class="speed">Starting...</span>
                <span class="count">0 B / ${formatBytes(size)}</span>
            </div>
        `;
        transfers.prepend(element);
        return element;
    }

    function updateTransfer(element, percent, transferred, total, currentSpeed, complete = false) {
        const bar = element.querySelector(".progressBar");
        const percentage = element.querySelector(".percent");
        const speedElement = element.querySelector(".speed");
        const count = element.querySelector(".count");

        if (bar) bar.style.width = Math.min(100, Math.max(0, percent)) + "%";
        if (percentage) percentage.textContent = Math.round(percent) + "%";
        if (count) count.textContent = formatBytes(transferred) + " / " + formatBytes(total);
        if (speedElement) {
            speedElement.textContent = complete
                ? "Complete ✓"
                : currentSpeed > 0
                    ? formatSpeed(currentSpeed)
                    : "Transferring...";
        }
    }

    /* ==========================================================
       FILE SENDING ENGINE (UNIVERSAL MULTI-TRANSPORT)
    ========================================================== */
    async function sendFiles(files) {
        const transport = getActiveTransport();
        if (!transport) {
            alert("Please wait until the other device connects to this room.");
            return;
        }

        await requestWakeLock();

        for (const file of files) {
            outgoingQueue.push(file);
        }

        if (isSending) return;
        isSending = true;

        try {
            while (outgoingQueue.length > 0) {
                const currentFile = outgoingQueue.shift();
                await sendSingleFile(currentFile);
            }
        } finally {
            isSending = false;
            releaseWakeLock();
        }
    }

    async function sendSingleFile(file) {
        const transport = getActiveTransport();
        if (!transport) {
            alert("Connection lost. Unable to send " + file.name);
            return;
        }

        log(`Sending "${file.name}" (${formatBytes(file.size)}) via ${transport === "webrtc" ? "Direct P2P" : "Cloudflare Edge Relay"}...`);
        const ui = createTransferUI(file.name, file.size);
        const startTime = performance.now();
        let lastUpdate = startTime;
        let offset = 0;

        // 1. Send file metadata header
        sendControlMessage({
            type: "file-start",
            name: file.name,
            size: file.size,
            mime: file.type || "application/octet-stream"
        }, transport);

        // 2. Stream binary chunks with backpressure
        while (offset < file.size) {
            if (transport === "webrtc") {
                if (dataChannel.bufferedAmount > HIGH_WATER_MARK) {
                    await waitForDataChannelBuffer();
                }
            } else {
                if (socket.bufferedAmount > WS_HIGH_WATER_MARK) {
                    await waitForSocketBuffer();
                }
            }

            const chunk = file.slice(offset, offset + CHUNK_SIZE);
            const buffer = await chunk.arrayBuffer();

            if (transport === "webrtc") {
                dataChannel.send(buffer);
            } else {
                socket.send(buffer);
            }

            offset += buffer.byteLength;
            const now = performance.now();

            if (now - lastUpdate > 80 || offset === file.size) {
                const elapsed = (now - startTime) / 1000;
                const currentSpeed = elapsed > 0 ? offset / elapsed : 0;
                const percent = file.size === 0 ? 100 : (offset / file.size) * 100;
                updateTransfer(ui, percent, offset, file.size, currentSpeed);
                lastUpdate = now;
            }
        }

        // 3. Send file completion signal
        sendControlMessage({
            type: "file-end"
        }, transport);

        updateTransfer(ui, 100, file.size, file.size, 0, true);
        log(`Successfully sent "${file.name}".`);
    }

    function waitForDataChannelBuffer() {
        return new Promise(resolve => {
            if (!dataChannel || dataChannel.readyState !== "open") {
                resolve();
                return;
            }
            const check = () => {
                if (!dataChannel || dataChannel.readyState !== "open" || dataChannel.bufferedAmount <= LOW_WATER_MARK) {
                    resolve();
                } else {
                    setTimeout(check, 25);
                }
            };
            check();
        });
    }

    function waitForSocketBuffer() {
        return new Promise(resolve => {
            if (!socket || socket.readyState !== WebSocket.OPEN) {
                resolve();
                return;
            }
            const check = () => {
                if (!socket || socket.readyState !== WebSocket.OPEN || socket.bufferedAmount <= WS_LOW_WATER_MARK) {
                    resolve();
                } else {
                    setTimeout(check, 25);
                }
            };
            check();
        });
    }

    /* ==========================================================
       FILE RECEIVING ENGINE
    ========================================================== */
    function handleDataControlMessage(msg) {
        if (!msg || typeof msg !== "object") return;

        if (msg.type === "file-start") {
            requestWakeLock();
            const ui = createTransferUI(msg.name, msg.size);
            incomingFile = {
                name: msg.name,
                size: msg.size,
                mime: msg.mime || "application/octet-stream",
                chunks: [],
                received: 0,
                started: performance.now(),
                ui: ui
            };
            log(`Receiving file "${msg.name}" (${formatBytes(msg.size)})...`);
            return;
        }

        if (msg.type === "file-end") {
            finishIncomingFile();
            releaseWakeLock();
            return;
        }
    }

    function receiveChunk(data) {
        if (!incomingFile) return;

        const byteLength = data.byteLength || data.size || 0;
        incomingFile.chunks.push(data);
        incomingFile.received += byteLength;

        const now = performance.now();
        const elapsed = (now - incomingFile.started) / 1000;
        const currentSpeed = elapsed > 0 ? incomingFile.received / elapsed : 0;
        const percent = incomingFile.size === 0 ? 100 : (incomingFile.received / incomingFile.size) * 100;

        updateTransfer(incomingFile.ui, percent, incomingFile.received, incomingFile.size, currentSpeed);
    }

    function finishIncomingFile() {
        if (!incomingFile) return;

        if (incomingFile.received !== incomingFile.size) {
            log(`Error: File transfer incomplete. Expected ${incomingFile.size} bytes, got ${incomingFile.received}.`);
            incomingFile = null;
            return;
        }

        const blob = new Blob(incomingFile.chunks, { type: incomingFile.mime });
        const url = URL.createObjectURL(blob);
        const name = incomingFile.name;

        // Auto-download trigger
        try {
            const autoLink = document.createElement("a");
            autoLink.href = url;
            autoLink.download = name;
            autoLink.style.display = "none";
            document.body.appendChild(autoLink);
            autoLink.click();
            document.body.removeChild(autoLink);
        } catch (_) {}

        // Download actions for user & mobile
        const downloadLink = document.createElement("a");
        downloadLink.className = "downloadLink";
        downloadLink.href = url;
        downloadLink.download = name;
        downloadLink.rel = "noopener";
        downloadLink.textContent = "⬇ Download File";

        const openLink = document.createElement("a");
        openLink.className = "openLink";
        openLink.href = url;
        openLink.target = "_blank";
        openLink.rel = "noopener";
        openLink.textContent = "↗ Open / View File";

        const downloadArea = document.createElement("div");
        downloadArea.className = "downloadArea";
        downloadArea.appendChild(downloadLink);
        downloadArea.appendChild(openLink);

        const info = document.createElement("div");
        info.className = "info";
        info.textContent = "Saved to Downloads. Tap 'Open / View File' to preview or share to other apps.";
        downloadArea.appendChild(info);

        incomingFile.ui.appendChild(downloadArea);
        updateTransfer(incomingFile.ui, 100, incomingFile.size, incomingFile.size, 0, true);

        log(`File received successfully: "${name}".`);

        // Free blob memory after 30 minutes
        setTimeout(() => {
            try { URL.revokeObjectURL(url); } catch (_) {}
        }, 30 * 60 * 1000);

        incomingFile = null;
    }

    /* ==========================================================
       ROOM ACTIONS & EVENT LISTENERS
    ========================================================== */
    createButton.onclick = async function () {
        if (socket) return;
        room = createRoomKey();
        isCreator = true;
        openApp();
        log("Created room: " + room);
        await connectToSignaling();
    };

    joinButton.onclick = async function () {
        if (joinInputArea && joinInputArea.style.display === "none") {
            joinInputArea.style.display = "block";
            createButton.style.display = "none";
            roomInput.focus();
            return;
        }

        if (socket) return;
        room = cleanRoom(roomInput.value);

        if (!room) {
            alert("Please enter a valid room key.");
            return;
        }

        isCreator = false;
        openApp();
        log("Joining room: " + room);
        await connectToSignaling();
    };

    copyButton.onclick = async function () {
        try {
            await navigator.clipboard.writeText(room);
            copyButton.textContent = "Copied!";
            setTimeout(() => { copyButton.textContent = "Copy Key"; }, 1500);
        } catch {
            prompt("Copy this room key:", room);
        }
    };

    if (copyLinkButton) {
        copyLinkButton.onclick = async function () {
            const shareUrl = getRoomShareUrl();
            try {
                await navigator.clipboard.writeText(shareUrl);
                copyLinkButton.textContent = "Link Copied!";
                setTimeout(() => { copyLinkButton.textContent = "Copy Link"; }, 1500);
            } catch {
                prompt("Copy this direct join link:", shareUrl);
            }
        };
    }

    if (qrButton) {
        qrButton.onclick = function () {
            if (!qrCard) return;
            const isHidden = qrCard.classList.contains("hidden");
            if (isHidden) {
                qrCard.classList.remove("hidden");
                qrButton.textContent = "Hide QR";
            } else {
                qrCard.classList.add("hidden");
                qrButton.textContent = "QR Code";
            }
        };
    }

    fileInput.onchange = function (event) {
        if (!getActiveTransport()) {
            alert("Please wait until the other device connects to the room.");
            return;
        }
        const files = [...event.target.files];
        if (files.length > 0) {
            sendFiles(files);
        }
        fileInput.value = "";
    };

    dropZone.ondragover = function (event) {
        event.preventDefault();
        if (!getActiveTransport()) return;
        dropZone.classList.add("drag");
    };

    dropZone.ondragleave = function () {
        dropZone.classList.remove("drag");
    };

    dropZone.ondrop = function (event) {
        event.preventDefault();
        dropZone.classList.remove("drag");
        if (!getActiveTransport()) {
            alert("Please wait until the other device connects to the room.");
            return;
        }
        const files = [...event.dataTransfer.files];
        if (files.length > 0) {
            sendFiles(files);
        }
    };

    leaveButton.onclick = function () {
        leaving = true;
        clearInterval(heartbeatTimer);
        clearTimeout(p2pNegotiationTimer);
        releaseWakeLock();

        try { if (dataChannel) dataChannel.close(); } catch (_) {}
        try { if (peer) peer.close(); } catch (_) {}
        try { if (socket) socket.close(); } catch (_) {}

        dataChannel = null;
        peer = null;
        socket = null;
        peerJoined = false;
        webrtcConnected = false;
        activeTransport = null;
        offerSent = false;
        receivedOffer = false;
        pendingCandidates = [];
        incomingFile = null;
        outgoingQueue = [];
        room = "";
        isCreator = false;

        transfers.innerHTML = "";
        logs.textContent = "";
        roomInput.value = "";

        disableFileSharing();
        openJoin();
        setStatus("Disconnected", "waiting");
        leaving = false;
    };

    roomInput.onkeydown = function (event) {
        if (event.key === "Enter") {
            joinButton.click();
        }
    };

    /* ==========================================================
       AUTO-JOIN FROM URL (?room=XXXXXX)
    ========================================================== */
    window.addEventListener("DOMContentLoaded", async () => {
        const params = new URLSearchParams(window.location.search);
        const existingRoom = cleanRoom(params.get("room") || params.get("key") || "");
        if (existingRoom) {
            roomInput.value = existingRoom;
            room = existingRoom;
            isCreator = false;
            openApp();
            log("Auto-joining room from link: " + room);
            await connectToSignaling();
        }
    });

})();
