/* src/crypto.js */
window.ChatCrypto = (function () {
  'use strict';

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  // utils
  function ab2b64(ab) { return window.ChatUtil.ab2b64(ab); }
  function b642ab(b64) { return window.ChatUtil.b642ab(b64); }

  async function generateECDHKeyPair() {
    return crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveKey", "deriveBits"]
    );
  }

  async function exportPublicKeyToBase64(pubKey) {
    const raw = await crypto.subtle.exportKey("raw", pubKey); // ArrayBuffer
    return ab2b64(raw);
  }

  async function importPublicKeyFromBase64(b64) {
    const raw = b642ab(b64);
    return crypto.subtle.importKey(
      "raw",
      raw,
      { name: "ECDH", namedCurve: "P-256" },
      true,
      []
    );
  }

  async function deriveSharedAESKey(privateKey, remotePublicKey) {
    // derive 256 bits of shared secret and import as AES-GCM
    const derivedBits = await crypto.subtle.deriveBits(
      { name: "ECDH", public: remotePublicKey },
      privateKey,
      256
    );
    return crypto.subtle.importKey(
      "raw",
      derivedBits,
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function generateAESKey() {
    return crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );
  }

  async function exportAESKeyToBase64(key) {
    const raw = await crypto.subtle.exportKey("raw", key);
    return ab2b64(raw);
  }

  async function importAESKeyFromBase64(b64) {
    const raw = b642ab(b64);
    return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  }

  async function encryptAESGCM(key, plaintext) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext));
    return { iv: ab2b64(iv.buffer), ciphertext: ab2b64(ct) };
  }

  async function decryptAESGCM(key, iv_b64, ct_b64) {
    const iv = b642ab(iv_b64);
    const ct = b642ab(ct_b64);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    return dec.decode(pt);
  }

  // helper: derive key from password (optional, not used by default)
  async function deriveKeyFromPassword(password, salt_b64) {
    const salt = b642ab(salt_b64);
    const baseKey = await crypto.subtle.importKey(
      "raw",
      enc.encode(password),
      { name: "PBKDF2" },
      false,
      ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt,
        iterations: 200000,
        hash: "SHA-256"
      },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  return {
    generateECDHKeyPair,
    exportPublicKeyToBase64,
    importPublicKeyFromBase64,
    deriveSharedAESKey,
    generateAESKey,
    exportAESKeyToBase64,
    importAESKeyFromBase64,
    encryptAESGCM,
    decryptAESGCM,
    deriveKeyFromPassword
  };
})();
