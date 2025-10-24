/* src/storage.js */
window.ChatStorage = (function () {
  'use strict';

  // save messages array encrypted under userKey (CryptoKey AES-GCM)
  async function save(roomId, messages, userKey) {
    const plaintext = JSON.stringify(messages);
    const encObj = await ChatCrypto.encryptAESGCM(userKey, plaintext);
    localStorage.setItem(`chat:${roomId}`, JSON.stringify(encObj));
  }

  // load messages array; returns [] on missing or bad key
  async function load(roomId, userKey) {
    const raw = localStorage.getItem(`chat:${roomId}`);
    if (!raw) return [];
    try {
      const obj = JSON.parse(raw);
      const plaintext = await ChatCrypto.decryptAESGCM(userKey, obj.iv, obj.ciphertext);
      return JSON.parse(plaintext);
    } catch (err) {
      console.warn("ChatStorage: load failed", err);
      throw new Error("Unable to decrypt local chat — wrong local key or corrupted data");
    }
  }

  return { save, load };
})();
