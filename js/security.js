/**
 * Kypad Security Vault Engine
 * Implements Defense-in-Depth Cryptographic Architecture:
 * - Native Web Crypto API (SubtleCrypto)
 * - 256-bit AES-GCM Authenticated Decryption
 * - PBKDF2 Key Derivation Function (100,000 iterations, SHA-256)
 * - Multi-Part Split Key Secret Sharing (Threshold Architecture)
 * - Tamper-Resistant Object Freezing and Closure Scoping
 */
(function (global) {
    "use strict";

    // Key Share A: 32 bytes (256-bit entropy segment)
    // Combined with Share B at runtime via bitwise XOR to reconstruct master seed
    function _resolveEntropyShareA() {
        return new Uint8Array([
            185, 171, 29, 228, 138, 113, 85, 164,
            173, 53, 241, 27, 85, 16, 179, 229,
            154, 167, 243, 67, 249, 192, 187, 189,
            149, 13, 26, 241, 14, 88, 63, 131
        ]);
    }

    // Fast base64 to Uint8Array converter
    function _base64ToBytes(base64) {
        const binString = atob(base64);
        const len = binString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binString.charCodeAt(i);
        }
        return bytes;
    }

    // Scoped private decrypted configuration caches
    let _cachedClipboard = null;
    let _cachedQuickDrop = null;
    let _unlockPromise = null;

    async function _unlockVault() {
        if (_cachedClipboard && _cachedQuickDrop) {
            return { clipboard: _cachedClipboard, quickdrop: _cachedQuickDrop };
        }

        const subtle = global.crypto && global.crypto.subtle;
        if (!subtle) {
            throw new Error("Secure Context Error: Web Crypto API (SubtleCrypto) is required.");
        }

        const vaultData = global.__KYPAD_VAULT__;
        if (!vaultData || !vaultData.ciphertext || !vaultData.entropy) {
            throw new Error("Vault Integrity Error: Encrypted payload missing or corrupted.");
        }

        // Reconstruct Master Entropy Seed from threshold shares
        const shareA = _resolveEntropyShareA();
        const shareB = new Uint8Array(vaultData.entropy);
        if (shareA.length !== shareB.length) {
            throw new Error("Key Share Mismatch Error");
        }

        const masterSeed = new Uint8Array(shareA.length);
        for (let i = 0; i < shareA.length; i++) {
            masterSeed[i] = shareA[i] ^ shareB[i];
        }

        const saltBytes = _base64ToBytes(vaultData.salt);
        const ivBytes = _base64ToBytes(vaultData.iv);
        const ciphertextBytes = _base64ToBytes(vaultData.ciphertext);

        // Derive AES-GCM 256-bit key using PBKDF2 (100,000 iterations)
        const baseKey = await subtle.importKey(
            "raw",
            masterSeed,
            "PBKDF2",
            false,
            ["deriveKey"]
        );

        const aesKey = await subtle.deriveKey(
            {
                name: "PBKDF2",
                salt: saltBytes,
                iterations: 100000,
                hash: "SHA-256"
            },
            baseKey,
            { name: "AES-GCM", length: 256 },
            false,
            ["decrypt"]
        );

        // Decrypt with AES-GCM authenticated cipher
        const decryptedBuffer = await subtle.decrypt(
            { name: "AES-GCM", iv: ivBytes },
            aesKey,
            ciphertextBytes
        );

        // Decode JSON payload
        const decoder = new TextDecoder("utf-8");
        const jsonText = decoder.decode(decryptedBuffer);
        const payload = JSON.parse(jsonText);

        _cachedClipboard = Object.freeze(payload.clipboard);
        _cachedQuickDrop = Object.freeze(payload.quickdrop);

        // Memory hygiene: Remove global vault payload reference
        try {
            delete global.__KYPAD_VAULT__;
        } catch (_) {}

        return { clipboard: _cachedClipboard, quickdrop: _cachedQuickDrop };
    }

    const SecurityVault = {
        /**
         * Returns decrypted and verified Shared Clipboard configuration
         * @returns {Promise<{host: string, httpUrl: string, wsUrl: string}>}
         */
        async getClipboardConfig() {
            if (!_unlockPromise) {
                _unlockPromise = _unlockVault();
            }
            const data = await _unlockPromise;
            return data.clipboard;
        },

        /**
         * Returns decrypted and verified QuickDrop configuration
         * @returns {Promise<{signalingServer: string, wsUrl: string, rtcConfig: Object}>}
         */
        async getQuickDropConfig() {
            if (!_unlockPromise) {
                _unlockPromise = _unlockVault();
            }
            const data = await _unlockPromise;
            return data.quickdrop;
        }
    };

    // Prevent tampering
    Object.freeze(SecurityVault);

    // Expose on window / global scope
    Object.defineProperty(global, "SecurityVault", {
        value: SecurityVault,
        writable: false,
        configurable: false,
        enumerable: false
    });
})(typeof window !== "undefined" ? window : globalThis);
