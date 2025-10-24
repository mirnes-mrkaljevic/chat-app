/* src/ui.js */
window.ChatUI = (function () {
  'use strict';

  // DOM
  const $ = selector => document.querySelector(selector);
  const $all = sel => Array.from(document.querySelectorAll(sel));

  // elements
  const el = {
    setup: '#setup',
    startBtn: '#startBtn',
    roomInput: '#roomInput',
    generateRoomBtn: '#generateRoomBtn',
    roleSelect: '#roleSelect',
    username: '#username',
    localKeyInput: '#localKeyInput',
    genLocalKeyBtn: '#genLocalKeyBtn',
    exportLocalKeyBtn: '#exportLocalKeyBtn',
    inviteArea: '#inviteArea',
    inviteLink: '#inviteLink',
    copyInviteBtn: '#copyInviteBtn',
    status: '#status',
    chat: '#chat',
    roomLabel: '#roomLabel',
    peerIdLabel: '#peerIdLabel',
    participantsList: '#participantsList',
    messages: '#messages',
    messageInput: '#messageInput',
    sendBtn: '#sendBtn'
  };

  let localKey = null; // CryptoKey for local storage encryption
  let messagesBuffer = []; // message objects {from, ts, payload}
  let currentRoom = null;
  let username = null;
  let peerController = null;

  function setStatus(s) {
    $(el.status).textContent = s;
  }

  function showSetup() {
    $(el.setup).classList.remove('hidden');
    $(el.chat).classList.add('hidden');
  }
  function showChat() {
    $(el.setup).classList.add('hidden');
    $(el.chat).classList.remove('hidden');
  }

  // generate local AES key and set input to base64 export
  async function generateLocalKey() {
    const k = await ChatCrypto.generateAESKey();
    const b64 = await ChatCrypto.exportAESKeyToBase64(k);
    $(el.localKeyInput).value = b64;
    localKey = k;
    setStatus('Generated local storage key. Save it somewhere safe.');
  }

  // load local key from base64 input
  async function loadLocalKeyFromInput() {
    const v = $(el.localKeyInput).value.trim();
    if (!v) {
      localKey = null;
      return;
    }
    try {
      localKey = await ChatCrypto.importAESKeyFromBase64(v);
      setStatus('Imported local key.');
    } catch (err) {
      console.error(err);
      alert('Failed to import local key (invalid).');
      localKey = null;
    }
  }

  // export current local key value
  function exportLocalKeyToClipboard() {
    const v = $(el.localKeyInput).value.trim();
    if (!v) { alert('No local key to export'); return; }
    navigator.clipboard.writeText(v).then(() => {
      setStatus('Local key copied to clipboard (save it!).');
    }).catch(e => {
      console.warn(e);
      alert('Copy failed — just copy the key from the input manually.');
    });
  }

  // populate messages UI
  function renderMessages() {
    const ul = $(el.messages);
    ul.innerHTML = '';
    for (const m of messagesBuffer) {
      const li = document.createElement('li');
      li.classList.toggle('msg-self', m.from === peerController.getState().myPeerId);
      const meta = document.createElement('div');
      meta.className = 'msg-meta';
      const when = new Date(m.ts).toLocaleTimeString();
      meta.textContent = `${m.from} • ${when}`;
      const body = document.createElement('div');
      body.className = 'msg-body';
      // if payload has `type: 'link'` or looks like URL, render as link
      const text = m.payload?.text || '';
      if (m.payload?.type === 'link' || isProbablyUrl(text)) {
        const a = document.createElement('a');
        a.href = text;
        a.target = '_blank';
        a.textContent = text;
        body.appendChild(a);
      } else {
        body.textContent = text;
      }
      li.appendChild(meta);
      li.appendChild(body);
      ul.appendChild(li);
    }
    // scroll to bottom
    ul.scrollTop = ul.scrollHeight;
  }

  function isProbablyUrl(s) {
    return /^https?:\/\//i.test(String(s));
  }

  // Save buffer to localStorage encrypted with localKey
  async function persistMessages() {
    if (!localKey) {
      // don't persist without user key
      return;
    }
    try {
      await ChatStorage.save(currentRoom, messagesBuffer, localKey);
    } catch (err) {
      console.warn('persistMessages failed', err);
    }
  }

  // Load history for room
  async function loadHistory() {
    if (!localKey) return [];
    try {
      const arr = await ChatStorage.load(currentRoom, localKey);
      return arr || [];
    } catch (err) {
      // bad local key — inform user
      alert('Unable to decrypt saved messages with this local key. Either import correct key or clear storage for this room.');
      return [];
    }
  }

  // Called by ChatPeer when a new message arrives (or loopback for own sends)
  async function onPeerMessage(msg) {
    // msg: {from, ts, payload}
    messagesBuffer.push(msg);
    renderMessages();
    await persistMessages();
  }

  // participants update
  function onParticipants(list) {
    $(el.participantsList).textContent = list.join(', ');
  }

  // Start the chat (create or join)
  async function start() {
    await loadLocalKeyFromInput();
    if (!localKey) {
      alert('You must provide or generate a local key to encrypt your local storage.');
      return;
    }

    username = $(el.username).value.trim() || ('u' + Math.random().toString(36).slice(2,6));
    const role = $(el.roleSelect).value;
    let room = $(el.roomInput).value.trim();

    if (!room) {
      // auto-generate for create role
      if (role === 'create') {
        room = ChatUtil.generateRoomId();
        $(el.roomInput).value = room;
      } else {
        alert('Please provide a room id to join (or ask the creator to send the invite link).');
        return;
      }
    }

    currentRoom = room;
    setStatus('Initializing peer...');

    // hide setup, show chat
    showChat();
    $(el.roomLabel).textContent = `Room: ${currentRoom}`;

    // instantiate peer controller
    peerController = ChatPeer;
    await peerController.init({
      roomId: currentRoom,
      role: role,
      username: username,
      onMessage: onPeerMessage,
      onParticipants: onParticipants
    });

    // if joiner, make sure we announce to creator so creator will encrypt room key to us
    if (role === 'join') {
      // send announce to creator (this will trigger creator to send roomKey + peerList)
      setTimeout(() => peerController.announceToCreator(), 600);
    }

    // build invite link (creator should share it)
    const inviteUrl = `${location.origin}${location.pathname}?room=${encodeURIComponent(currentRoom)}`;
    $(el.inviteLink).value = inviteUrl;
    $(el.inviteArea).classList.remove('hidden');
    $(el.peerIdLabel).textContent = `Your peer id: ${peerController.getState().myPeerId}`;

    // load history with localKey
    messagesBuffer = await loadHistory();
    renderMessages();
    setStatus('Connected (may take a few seconds to discover peers).');

    // hook send button
    $(el.sendBtn).addEventListener('click', async () => {
      const text = $(el.messageInput).value.trim();
      if (!text) return;
      const payload = { text };
      await peerController.sendPlain({ text, sender: username, type: isProbablyLink(text) ? 'link' : 'text' });
      $(el.messageInput).value = '';
    });

    // participants initial
    onParticipants(peerController.getState().connectedPeers || []);
  }

  function isProbablyLink(s) {
    return /^https?:\/\//i.test(String(s));
  }

  // Wire up UI events
  function init() {
    // populate room input from URL
    const q = ChatUtil.parseQuery();
    if (q.room) $(el.roomInput).value = q.room;

    $(el.generateRoomBtn).addEventListener('click', () => {
      $(el.roomInput).value = ChatUtil.generateRoomId();
    });

    $(el.genLocalKeyBtn).addEventListener('click', generateLocalKey);
    $(el.exportLocalKeyBtn).addEventListener('click', exportLocalKeyToClipboard);

    $(el.startBtn).addEventListener('click', start);

    $(el.copyInviteBtn).addEventListener('click', () => {
      const val = $(el.inviteLink).value;
      navigator.clipboard.writeText(val).then(() => setStatus('Invite link copied.'));
    });

    $(el.localKeyInput).addEventListener('change', async () => {
      await loadLocalKeyFromInput();
    });

    // enter to send
    $(el.messageInput).addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        $(el.sendBtn).click();
      }
    });
  }

  return { init };
})();
