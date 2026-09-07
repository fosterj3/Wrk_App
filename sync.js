/**
 * Device-to-device transfer.
 *
 * Not sync and not an account. One device seals its log, parks it for a few
 * minutes, and reads out a short code; the other device types the code and
 * takes it. The parked copy is deleted as soon as it is claimed.
 *
 * The code is the whole secret. Both the storage location and the encryption
 * key are derived from it, so the relay only ever holds ciphertext under a
 * name it cannot connect to anything. Losing the code means the transfer is
 * unrecoverable, which is the intended trade — it expires in fifteen minutes
 * anyway, and the original device still has the data.
 *
 * Everything below the transport is pure and covered by tests.
 */

/* Crockford's base32: no I, L, O or U, so nothing reads as another character
   when it is squinted at across a room. 10 characters is 50 bits. */
const TRANSFER_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TRANSFER_CODE_LEN = 10;
const TRANSFER_TTL_MS = 15 * 60 * 1000;

/* 256 is a whole multiple of 32, so taking a byte modulo the alphabet length
   is uniform — no modulo bias to correct for. */
function makeTransferCode() {
  const bytes = new Uint8Array(TRANSFER_CODE_LEN);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += TRANSFER_ALPHABET[bytes[i] % 32];
  return out;
}

/* Shown in two groups — a ten-character run gets lost halfway across. */
function formatTransferCode(code) {
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

/* Typed by a human reading a phone screen, so accept the confusions the
   alphabet was chosen to avoid rather than rejecting them. */
function normalizeTransferCode(input) {
  return String(input || '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
}

function isTransferCode(code) {
  if (code.length !== TRANSFER_CODE_LEN) return false;
  return [...code].every((c) => TRANSFER_ALPHABET.includes(c));
}

/* Chunked because spreading a few hundred KB into String.fromCharCode blows
   the argument limit on exactly the large logs this feature is for. */
function bytesToBase64(bytes) {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * The relay never sees the code, only a hash of it, so a leaked listing of
 * document names still cannot be turned back into a key. PBKDF2 is cheap
 * insurance here rather than the main defence — the code is 50 random bits,
 * not a human-chosen password.
 */
async function deriveTransfer(code) {
  const enc = new TextEncoder();

  const idBits = await crypto.subtle.digest('SHA-256', enc.encode(`cadence-transfer-id:${code}`));
  const docId = [...new Uint8Array(idBits).subarray(0, 16)]
    .map((b) => b.toString(16).padStart(2, '0')).join('');

  const material = await crypto.subtle.importKey('raw', enc.encode(code), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('cadence-transfer-v1'), iterations: 200000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  return { docId, key };
}

async function sealTransfer(payload, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(payload));
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  return { blob: bytesToBase64(new Uint8Array(sealed)), iv: bytesToBase64(iv) };
}

/* AES-GCM fails closed: a wrong key throws rather than returning noise, which
   is what lets a mistyped code be reported as a mistyped code. */
async function openTransfer(record, key) {
  const opened = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(record.iv) },
    key,
    base64ToBytes(record.blob)
  );
  return JSON.parse(new TextDecoder().decode(opened));
}

/* ------------------------------------------------------------- the relay */

/* Filled in from your own Firebase project — see the README. Both values are
   meant to be public: the API key names the project, it does not authorise
   anything. What can be written and read is decided by the security rules,
   which live on Google's side where nobody can edit them from here.
   Left empty, the whole feature stays hidden and nothing else changes. */
const SYNC_CONFIG = {
  projectId: '',
  apiKey: '',
};

function syncConfigured() {
  return Boolean(SYNC_CONFIG.projectId && SYNC_CONFIG.apiKey);
}

function transferUrl(docId) {
  const base = `https://firestore.googleapis.com/v1/projects/${SYNC_CONFIG.projectId}`
    + '/databases/(default)/documents/transfers';
  const tail = docId ? `/${docId}` : '';
  return `${base}${tail}?key=${SYNC_CONFIG.apiKey}`;
}

/**
 * Firestore's REST API rather than the SDK: it is a handful of fetch calls,
 * it needs no bundler, and it keeps the app a set of plain scripts. Swapped
 * out wholesale by the tests.
 */
const firestoreTransport = {
  async put(docId, record) {
    const res = await fetch(`${transferUrl()}&documentId=${docId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          blob: { stringValue: record.blob },
          iv: { stringValue: record.iv },
          createdAt: { timestampValue: new Date().toISOString() },
          expiresAt: { timestampValue: new Date(Date.now() + TRANSFER_TTL_MS).toISOString() },
        },
      }),
    });
    if (!res.ok) throw new Error(await describeError(res));
  },

  async get(docId) {
    const res = await fetch(transferUrl(docId));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(await describeError(res));
    const doc = await res.json();
    const f = doc.fields || {};
    if (!f.blob || !f.iv) return null;
    return {
      blob: f.blob.stringValue,
      iv: f.iv.stringValue,
      expiresAt: f.expiresAt ? f.expiresAt.timestampValue : null,
    };
  },

  /* Best effort. The server-side expiry is what guarantees it goes away; this
     just takes it out of reach the moment it has been claimed. */
  async remove(docId) {
    try { await fetch(transferUrl(docId), { method: 'DELETE' }); } catch (err) { /* expiry handles it */ }
  },
};

async function describeError(res) {
  try {
    const body = await res.json();
    const msg = body && body.error && body.error.message;
    if (msg) return `${res.status}: ${msg}`;
  } catch (err) { /* fall through to the status alone */ }
  return `the relay returned ${res.status}`;
}

let transferTransport = firestoreTransport;
function setTransferTransport(t) { transferTransport = t; }

/* --------------------------------------------------------------- the flow */

/**
 * Seals `payload` and parks it. Returns the code to read out — the only copy
 * of it, since it is never stored.
 */
async function sendTransfer(payload) {
  const code = makeTransferCode();
  const { docId, key } = await deriveTransfer(code);
  await transferTransport.put(docId, await sealTransfer(payload, key));
  return { code, docId, expiresAt: new Date(Date.now() + TRANSFER_TTL_MS) };
}

/**
 * Claims a parked transfer. Every failure is reported as the thing that
 * actually went wrong — a typo, an expiry and a wrong-but-valid code are
 * different problems and want different advice.
 */
async function receiveTransfer(rawCode) {
  const code = normalizeTransferCode(rawCode);
  if (!isTransferCode(code)) {
    throw new Error(`A code is ${TRANSFER_CODE_LEN} characters. Check for a missed one.`);
  }

  const { docId, key } = await deriveTransfer(code);
  const record = await transferTransport.get(docId);
  if (!record) {
    throw new Error('No transfer waiting under that code. It may have expired, or already been picked up.');
  }
  if (record.expiresAt && Date.now() > +new Date(record.expiresAt)) {
    await transferTransport.remove(docId);
    throw new Error('That transfer has expired. Start a new one on the other device.');
  }

  let payload;
  try {
    payload = await openTransfer(record, key);
  } catch (err) {
    throw new Error('That code did not unlock the transfer. Check it and try again.');
  }

  await transferTransport.remove(docId);
  return payload;
}

if (typeof module !== 'undefined') {
  module.exports = {
    makeTransferCode, formatTransferCode, normalizeTransferCode, isTransferCode,
    deriveTransfer, sealTransfer, openTransfer, sendTransfer, receiveTransfer,
    setTransferTransport, syncConfigured, bytesToBase64, base64ToBytes,
  };
}
