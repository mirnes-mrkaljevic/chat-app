/* src/peer.js */
window.ChatPeer = (function () {
  'use strict';

  // internal state
  let peer = null;
  const connMap = new Map(); // peerId -> DataConnection
  let my = { peerId: null, ecdhPair: null, pubB64: null, username: null };
  let roomId = null;
  let isCreator = false;
  let roomKey = null; // CryptoKey AES for room encryption
  let onMessageCallback = null;
  let onParticipantChange = null;

  // Initialize PeerJS and crypto. role: 'create' | 'join'
  async function init(opts) {
    // opts: {roomId, role, username, localKey (CryptoKey), onMessage, onParticipants}
    roomId = opts.roomId;
    isCreator = opts.role === 'create';
    my.username = opts.username || 'Anon';
    onMessageCallback = opts.onMessage;
    onParticipantChange = opts.onParticipants;

    // make ECDH pair
    my.ecdhPair = await ChatCrypto.generateECDHKeyPair();
    my.pubB64 = await ChatCrypto.exportPublicKeyToBase64(my.ecdhPair.publicKey);

    // Peer id strategy:
    // creator: peerId == roomId
    // joiner: peerId == `${roomId}:${random}`
    const pid = isCreator ? roomId : `${roomId}:${ChatUtil.randSuffix()}`;
    my.peerId = pid;

    // create PeerJS peer
    peer = new Peer(pid, {
  debug: 2,
  host: '0.peerjs.com',
  port: 443,
  secure: true,
  path: '/',
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478?transport=udp' }
    ]
  }
});
      console.log('new Peer', pid);

    peer.on('open', id => {
      console.log('peer open', id);
      if (isCreator) {
        // creator makes room key now
        console.log('isCreator');
        (async () => {
          roomKey = await ChatCrypto.generateAESKey();
          console.log('Generated roomKey (creator)');
        })();
      } else {
        // joiner -> connect to creator
        console.log('joiner');
        connectToPeer(roomId);
      }
    });

    peer.on('connection', conn => {
      // handle incoming connections
      console.log('connection');
      if (isCreator) {
      handleConnection(conn);
      }
    });

    peer.on('error', err => {
      console.error('Peer error', err);
      // bubble by callback (UI will handle)
      if (opts.onError) opts.onError(err);
    });

    // expose a function for sending plain object messages
    return {
      sendPlain: sendPlain
    };
  }

  // connect to peer id (initiates outgoing connection)
  function connectToPeer(theirId) {
    if (!peer) throw new Error('Peer not initialized');
    if (connMap.has(theirId)) return connMap.get(theirId);

    const conn = peer.connect(theirId, { reliable: true });
    conn.on('open', () => {
      console.log(`outgoing open -> ${theirId}`);
      // send our public key immediately
      conn.send(JSON.stringify({ type: 'publicKey', from: my.peerId, payload: my.pubB64, username: my.username }));
    });
    conn.on('data', raw => {
      let msg = parseSafe(raw);
      if (msg) handleProtocolMessage(conn, msg);
    });
    conn.on('close', () => {
      console.log('connection closed', theirId);
      connMap.delete(theirId);
      notifyParticipants();
    });
    connMap.set(theirId, conn);
    notifyParticipants();
    return conn;
  }

  // Accept incoming connection
  function handleConnection(conn) {
    conn.on('open', () => {
      console.log('incoming connection open from', conn.peer);
      // send our public key
      conn.send(JSON.stringify({ type: 'publicKey', from: my.peerId, payload: my.pubB64, username: my.username }));
      connMap.set(conn.peer, conn);
      notifyParticipants();
    });
    conn.on('data', raw => {
      let msg = parseSafe(raw);
      if (msg) handleProtocolMessage(conn, msg);
    });
    conn.on('close', () => {
      console.log('incoming conn closed', conn.peer);
      connMap.delete(conn.peer);
      notifyParticipants();
    });
  }

  // Parse JSON safely
  function parseSafe(raw) {
    try {
      if (typeof raw === 'object' && raw !== null) return raw; // sometimes PeerJS gives object
      return JSON.parse(raw);
    } catch (e) {
      console.warn('parseSafe failed', e);
      return null;
    }
  }

  // Notify UI about participants
  function notifyParticipants() {
    if (onParticipantChange) onParticipantChange(Array.from(connMap.keys()).concat([my.peerId]));
  }

  // Handles control messages (publicKey, announce, roomKey, peerList, newPeer, msg)
  async function handleProtocolMessage(conn, msg) {
    switch (msg.type) {
      case 'publicKey': {
        // store their public key on connection for later use
        conn._theirPub = await ChatCrypto.importPublicKeyFromBase64(msg.payload);
        conn._theirName = msg.username || msg.from;
        break;
      }

      case 'announce': {
        // Joiner announces to creator with its public key; only creator should handle
        if (!isCreator) return;
        const theirId = msg.from;
        const theirPubB64 = msg.payload.pubKey;
        const theirPub = await ChatCrypto.importPublicKeyFromBase64(theirPubB64);

        // ensure we have a connection object to that peer
        let connToNew = connMap.get(theirId);
        if (!connToNew) {
          connToNew = connectToPeer(theirId);
          // wait for their public key to be set via incoming publicKey message; but we already have theirPub here
          connToNew._theirPub = theirPub;
        }

        // derive shared key and encrypt roomKey for them
        const derived = await ChatCrypto.deriveSharedAESKey(my.ecdhPair.privateKey, theirPub);
        const roomRaw = await ChatCrypto.exportAESKeyToBase64(roomKey);
        const enc = await ChatCrypto.encryptAESGCM(derived, roomRaw);

        // send roomKey to new peer
        connToNew.on('open', () => {
          connToNew.send(JSON.stringify({ type: 'roomKey', from: my.peerId, payload: enc }));
          // send peerList so new peer can connect to others
          connToNew.send(JSON.stringify({ type: 'peerList', from: my.peerId, payload: Array.from(connMap.keys()).concat([my.peerId]) }));
        });

        // inform existing peers about the newcomer so they can connect (creator coordinates)
        for (const [pid, c] of connMap.entries()) {
          if (pid === theirId) continue;
          if (c.open) {
            c.send(JSON.stringify({ type: 'newPeer', from: my.peerId, payload: { peerId: theirId } }));
          }
        }

        break;
      }

      case 'roomKey': {
        // joiner receives encrypted room key from creator
        // we need conn._theirPub (creator's pub) and our private to derive shared key
        try {
          const theirPub = conn._theirPub;
          const shared = await ChatCrypto.deriveSharedAESKey(my.ecdhPair.privateKey, theirPub);
          const roomRawB64 = await ChatCrypto.decryptAESGCM(shared, msg.payload.iv, msg.payload.ciphertext);
          roomKey = await ChatCrypto.importAESKeyFromBase64(roomRawB64);
          console.log('Received roomKey and imported (joiner).');
        } catch (err) {
          console.error('Failed roomKey handling', err);
        }
        break;
      }

      case 'peerList': {
        // connect to peers listed (used when joiner first connects to creator)
        const list = msg.payload || [];
        for (const pid of list) {
          if (pid === my.peerId || connMap.has(pid)) continue;
          connectToPeer(pid);
        }
        break;
      }

      case 'newPeer': {
        // creator told existing peers to connect to a newcomer
        const newPid = msg.payload.peerId;
        if (!connMap.has(newPid) && newPid !== my.peerId) {
          connectToPeer(newPid);
        }
        break;
      }

      case 'announceRequest': {
        // simpler announce flow: creator requests the remote to send their announce
        if (!isCreator) {
          // send announce back with public key
          conn.send(JSON.stringify({ type: 'announce', from: my.peerId, payload: { pubKey: my.pubB64 } }));
        }
        break;
      }

      case 'msg': {
        // encrypted message envelope; decrypt with roomKey
        const payload = msg.payload;
        if (!roomKey) {
          console.warn('Received msg but no roomKey yet');
          return;
        }
        try {
          const plaintext = await ChatCrypto.decryptAESGCM(roomKey, payload.iv, payload.ciphertext);
          const obj = JSON.parse(plaintext);
          // annotate with from and ts
          if (onMessageCallback) onMessageCallback({ from: msg.from, ts: msg.ts || Date.now(), payload: obj });
        } catch (err) {
          console.warn('decrypt message failed', err);
        }
        break;
      }
    }
  }

  // Send a plain JSON-serializable object as a message to all peers (encrypted with roomKey)
  async function sendPlain(obj) {
    if (!roomKey) throw new Error('No roomKey available');
    const pt = JSON.stringify(obj);
    const enc = await ChatCrypto.encryptAESGCM(roomKey, pt);
    const envelope = { type: 'msg', from: my.peerId, ts: Date.now(), payload: enc };
    // send to all connections
    for (const [pid, conn] of connMap.entries()) {
      if (conn.open) conn.send(JSON.stringify(envelope));
    }
    // loopback to UI
    if (onMessageCallback) onMessageCallback({ from: my.peerId, ts: Date.now(), payload: obj });
  }

  // Public function to start announce (joiner sends announce to creator)
  function announceToCreator() {
    const creatorId = roomId;
    const conn = connMap.get(creatorId);
    if (conn && conn.open) {
      conn.send(JSON.stringify({ type: 'announce', from: my.peerId, payload: { pubKey: my.pubB64 } }));
    } else {
      // if no connection object, create one
      const c = connectToPeer(creatorId);
      c.on('open', () => {
        c.send(JSON.stringify({ type: 'announce', from: my.peerId, payload: { pubKey: my.pubB64 } }));
      });
    }
  }

  // Expose read-only state helper
  function getState() {
    return {
      myPeerId: my.peerId,
      roomId,
      isCreator,
      connectedPeers: Array.from(connMap.keys())
    };
  }

  // export
  return {
    init,
    sendPlain,
    announceToCreator,
    getState
  };
})();
