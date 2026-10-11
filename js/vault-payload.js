/**
 * Kypad Cryptographic Vault Payload
 * Encrypted with military-grade AES-256-GCM authenticated cipher.
 * Contains split-key threshold entropy Share B (disguised array).
 * This file contains zero plain-text API keys, endpoints, or worker addresses.
 */
(function (global) {
    "use strict";

    const VAULT_STORE = {
        // 128-bit cryptographic salt for PBKDF2 key derivation
        salt: "3mGou9H7L+2rOBPGGuCbzg==",

        // 96-bit random IV (Initialization Vector) for AES-GCM
        iv: "0s19smH6F5Ei9oF5",

        // Authenticated AES-GCM 256-bit ciphertext with embedded authentication tag
        ciphertext: "VooXq3ot/ZE8dqImySM28JbYJGVL1XHzMM+Z37FyrDtvRi0xbfVY0J9bxSKcG+T8waQlXW3p5r0yFVHlahqNgEujg8UW/M4mH3EvHcQ8r5YVQs/iLwPsfq0mobJiWLaZ6W++WNk+M9yx5mbHcJtlwXec+/0yvgPV8z7bLuFhWB/LjpHvjTLAb1lKzoaKTzcfs2BJpx820bz4hTu00UBKd663R9Bx5XJZeGLrSRCnm0AiNgOIBhzA9r4EcO/1azVL4K/l6hEK+Ki4nrN7It4k07gXGDh3YEJKwzzsOYrLgIO0Px7g1/+MFisKl8kiqu7gjLbRIVY7njwpqF7IWF6NvtOnYk91Wy6orSTX4PR9j2/IzxmaEbV1glw5iBbKKLcPlpMQD06xOJfcA6B8Bqm9Hym5qrpXZDbwCtlko746dNyftMFV3fRUK8/MUCPziGr9VBRbClrhqDKYhxY1XCrKnwtXAxeyaTatHFwUt2qJOVvLLgFDgkJ0+6y9ZRT8mPMjYf5nPKcUP4QXQ9Dhry2yaGmNZAmAUWXqGbs/16u9yf67gp3EKcW+h+1gxrHS+/z8flt3ypD97Uhn2Ijb02CBwnjEliRFeUaKj0nOHRwhAPW4fJu2S/9djx+zuJAP/ixRNCcy37nbcskcwzSfIqMZ/lYbpkyY725gaXcII3syCyBhibB71JJ+jmxYkor/4b9LyDXjKB0tWBtj0+doKEaCqmOBQHBL3Yh+YoOsjuSXs7tvLbBDL0scnENbusBeDlu1W/ANXgbqVWoCSqWXTzK8gT9qre8schY3IcgIZueuhtlgWvfRrBh+sPTnLiOej5em/2BphNbTytpXlg1Os7gpir9H8hDV4yzqDWjdnY1wJoTlo7+B4FHBtYWGxmAk6oUKtAr2v05vo+Xp6+SFhgYoJLVxMJuYUl7Vb/hWv8oX/RPqppphLDgEiw1l+eMZqZU/kZm6qwsF+s6aU5u2mg2T24NQxKdPznmuywaklTshht7Qw7vxWVy0m3AEZlo7fdl54n1AWvcaPYAzVBELy6bPdAQ3v+9xdqWP45zbPdMZLAQhfjrrnND62I5lY1EUJMPvwbFGDZ6J7JpQ",

        // Entropy Share B (256-bit split key threshold segment)
        entropy: [
            68, 237, 253, 16, 216, 222, 242, 92,
            168, 89, 165, 170, 61, 48, 116, 28,
            197, 138, 174, 116, 175, 180, 18, 91,
            203, 253, 187, 159, 35, 105, 253, 246
        ]
    };

    // Seal and expose securely for the SecurityVault
    Object.defineProperty(global, "__KYPAD_VAULT__", {
        value: Object.freeze(VAULT_STORE),
        writable: false,
        configurable: true,
        enumerable: false
    });
})(typeof window !== "undefined" ? window : globalThis);
