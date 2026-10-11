/**
 * Kypad Application Controller
 * Handles UI interactions, keyboard shortcuts, and view orchestration.
 */
document.addEventListener("DOMContentLoaded", () => {
    "use strict";

    const keyInput = document.getElementById("keyInput");
    const enterButton = document.getElementById("enterButton");
    const updateButton = document.getElementById("updateButton");
    const backButton = document.getElementById("backButton");
    const generateKeyButton = document.getElementById("generateKeyButton");
    const pad = document.getElementById("pad");
    const transferBtn = document.getElementById("transferButton");

    // Enter room button
    if (enterButton) {
        enterButton.addEventListener("click", () => {
            window.KypadClipboard.openPad();
        });
    }

    // Enter key press in input
    if (keyInput) {
        keyInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                window.KypadClipboard.openPad();
            }
        });
    }

    // Generate random secure key
    if (generateKeyButton) {
        generateKeyButton.addEventListener("click", () => {
            keyInput.value = window.KypadClipboard.generateSecureKey();
            keyInput.focus();
        });
    }

    // Unsaved changes detector
    if (pad) {
        pad.addEventListener("input", () => {
            window.KypadClipboard.markUnsaved();
        });

        // Ctrl+S / Cmd+S shortcut to save
        pad.addEventListener("keydown", (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "s") {
                e.preventDefault();
                window.KypadClipboard.savePad();
            }
        });
    }

    // Save/Update button
    if (updateButton) {
        updateButton.addEventListener("click", () => {
            window.KypadClipboard.savePad();
        });
    }

    // Back button
    if (backButton) {
        backButton.addEventListener("click", () => {
            window.KypadClipboard.closePad();
        });
    }

    // P2P File Transfer navigation
    if (transferBtn) {
        transferBtn.addEventListener("click", () => {
            alert("NOTE: Please make sure both devices are connected to the same network for direct peer-to-peer file transfer.");
            window.location.href = "transfer.html";
        });
    }

    // Check for room parameter in URL
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get("room") || urlParams.get("key");
    if (roomParam && keyInput) {
        keyInput.value = roomParam.trim();
        window.KypadClipboard.openPad();
    }
});

// Global fallback for inline onclick="startFileTransfer()"
window.startFileTransfer = function () {
    alert("NOTE: Please make sure both devices are connected to the same network for direct peer-to-peer file transfer.");
    window.location.href = "transfer.html";
};
