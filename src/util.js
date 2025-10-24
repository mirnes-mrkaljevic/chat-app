/* src/util.js */
window.ChatUtil = (function () {
  'use strict';

  function generateRoomId() {
    // 128-bit random hex (32 hex chars)
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }

  function randSuffix() {
    return Math.random().toString(36).slice(2, 9);
  }

  function parseQuery() {
    const params = new URLSearchParams(location.search);
    const out = {};
    for (const [k, v] of params.entries()) out[k] = v;
    return out;
  }

  function safeParseJSON(s) {
    try { return JSON.parse(s); } catch (e) { return null; }
  }

  function ab2b64(ab) {
    return btoa(String.fromCharCode(...new Uint8Array(ab)));
  }
  function b642ab(b64) {
    return Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;
  }

  return {
    generateRoomId,
    randSuffix,
    parseQuery,
    safeParseJSON,
    ab2b64,
    b642ab
  };
})();
