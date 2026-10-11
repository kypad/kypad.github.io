/**
 * Kypad Shared Clipboard Module
 * Handles WebSocket real-time synchronization, history retrieval,
 * secure room key generation, and clipboard UI status management.
 */
(function (global) {
    "use strict";

    let ws = null;
    let room = "";
    let suppress = false;

    // DOM references
    const keyInput = document.getElementById("keyInput");
    const keyScreen = document.getElementById("keyScreen");
    const padScreen = document.getElementById("padScreen");
    const pad = document.getElementById("pad");
    const status = document.getElementById("status");
    const padName = document.getElementById("padName");

    function updateStatus(text) {
        if (!status) return;
        status.textContent = text;

        let color = "#a1a1aa";
        if (text === "ready" || text === "saved") {
            color = "#10b981"; // Green for ready / saved
        } else if (text === "saving...") {
            color = "#3b82f6"; // Blue for saving
        } else if (text === "unsaved") {
            color = "var(--primary)"; // Orange for unsaved
        } else if (text.includes("error") || text === "disconnected") {
            color = "#ef4444"; // Red for errors
        }

        status.style.setProperty("--status-color", color);
    }

    function generateSecureKey(length = 22) {
        const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        const bytes = new Uint8Array(length);
        if (window.crypto && window.crypto.getRandomValues) {
            window.crypto.getRandomValues(bytes);
        } else {
            for (let i = 0; i < length; i++) {
                bytes[i] = Math.floor(Math.random() * 256);
            }
        }
        return Array.from(bytes, (b) => charset[b % charset.length]).join("");
    }

    async function openPad() {
        room = keyInput.value.trim();

        if (!room) {
            keyInput.focus();
            return;
        }

        /* Switch screens */
        keyScreen.style.display = "none";
        padScreen.style.display = "block";

        /* Display key */
        padName.textContent = room;

        updateStatus("loading...");

        try {
            // Retrieve encrypted endpoint configuration securely
            const config = await global.SecurityVault.getClipboardConfig();
            const apiHost = config.host;

            // Fetch room history
            try {
                const res = await fetch(`https://${apiHost}/history?room=${encodeURIComponent(room)}`);
                const history = await res.json();
                pad.value = history && history.length ? (history[history.length - 1].text || "") : "";
            } catch (fetchErr) {
                console.warn("History fetch notice:", fetchErr.message);
                pad.value = "";
            }

            // Establish real-time WebSocket connection
            ws = new WebSocket(`wss://${apiHost}/?room=${encodeURIComponent(room)}`);

            ws.onopen = () => {
                updateStatus("ready");
            };

            ws.onmessage = (e) => {
                try {
                    const m = JSON.parse(e.data);
                    if (typeof m.text !== "string") return;

                    suppress = true;
                    pad.value = m.text;
                    updateStatus("saved");
                } catch (parseErr) {
                    console.error("Invalid WebSocket message:", parseErr);
                }
            };

            ws.onerror = () => {
                updateStatus("connection error");
            };

            ws.onclose = () => {
                updateStatus("disconnected");
            };
        } catch (vaultErr) {
            console.error("Security Vault authentication error:", vaultErr);
            updateStatus("vault error");
        }

        pad.focus();
    }

    function savePad() {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            updateStatus("not connected");
            return;
        }

        updateStatus("saving...");

        ws.send(
            JSON.stringify({
                user: "__pad__",
                text: pad.value,
                time: Date.now()
            })
        );

        updateStatus("saved");
    }

    function closePad() {
        if (ws) {
            ws.close();
            ws = null;
        }

        padScreen.style.display = "none";
        keyScreen.style.display = "flex";

        updateStatus("idle");
        keyInput.focus();
    }

    function markUnsaved() {
        if (suppress) {
            suppress = false;
            return;
        }
        updateStatus("unsaved");
    }

    global.KypadClipboard = {
        openPad,
        savePad,
        closePad,
        markUnsaved,
        generateSecureKey,
        updateStatus
    };
})(typeof window !== "undefined" ? window : globalThis);
