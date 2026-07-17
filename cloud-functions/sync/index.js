import { getStore } from "@edgeone/pages-blob";

const RETENTION_MS = Number(process.env.RETENTION_MS || 3 * 24 * 60 * 60 * 1000);
const MAX_EVENTS_PER_CHANNEL = Number(process.env.MAX_EVENTS_PER_CHANNEL || 500);
const TIME_SKEW_MS = Number(process.env.TIME_SKEW_MS || 5 * 60 * 1000);
const STORE_NAME = process.env.BLOB_STORE_NAME || "fangcun-sync-aware";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type,x-fc-channel,x-fc-device,x-fc-timestamp,x-fc-nonce,x-fc-signature",
    },
  });
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function hmac(secret, message) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64Url(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

function constantTimeEqual(a, b) {
  const left = new TextEncoder().encode(String(a || ""));
  const right = new TextEncoder().encode(String(b || ""));
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left[index] ^ right[index];
  return diff === 0;
}

async function verifySignedRequest(request, body = "") {
  const url = new URL(request.url);
  const channelId = request.headers.get("x-fc-channel") || "";
  const deviceId = request.headers.get("x-fc-device") || "";
  const timestamp = request.headers.get("x-fc-timestamp") || "";
  const nonce = request.headers.get("x-fc-nonce") || "";
  const signature = request.headers.get("x-fc-signature") || "";
  if (!channelId || !deviceId || !timestamp || !nonce || !signature) {
    return { ok: false, status: 401, message: "Missing sync awareness signature headers." };
  }
  if (!process.env.SYNC_AWARE_SECRET) return { ok: false, status: 500, message: "SYNC_AWARE_SECRET is not configured." };
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > TIME_SKEW_MS) {
    return { ok: false, status: 401, message: "Signature timestamp is outside the allowed clock window." };
  }
  const expected = await hmac(process.env.SYNC_AWARE_SECRET, `${request.method.toUpperCase()}\n${url.pathname}\n${timestamp}\n${nonce}\n${body}`);
  if (!constantTimeEqual(expected, signature)) return { ok: false, status: 401, message: "Invalid sync awareness signature." };
  return { ok: true, channelId };
}

function eventKey(channelId, eventId) {
  return `channels/${channelId}/events/${eventId}.json`;
}

function channelIndexKey(channelId) {
  return `channels/${channelId}/index.json`;
}

async function blobStore() {
  return getStore(STORE_NAME, { consistency: "strong" });
}

async function readJson(store, key, fallback) {
  const item = await store.get(key);
  if (!item) return fallback;
  const text = typeof item.text === "function" ? await item.text() : String(item);
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

async function writeJson(store, key, value) {
  await store.put(key, JSON.stringify(value), { contentType: "application/json; charset=utf-8" });
}

async function readIndex(store, channelId) {
  const index = await readJson(store, channelIndexKey(channelId), []);
  const cutoff = Date.now() - RETENTION_MS;
  return Array.isArray(index)
    ? index.filter((item) => item && item.id && Number(item.createdAt || 0) >= cutoff).slice(-MAX_EVENTS_PER_CHANNEL)
    : [];
}

async function readEvents(store, channelId, since, limit) {
  const index = await readIndex(store, channelId);
  const start = since ? index.findIndex((item) => item.id === since) + 1 : Math.max(0, index.length - limit);
  const selected = index.slice(Math.max(0, start), Math.max(0, start) + limit);
  const events = [];
  for (const item of selected) {
    const event = await readJson(store, eventKey(channelId, item.id), null);
    if (event) events.push(event);
  }
  return { events, cursor: index.length ? index[index.length - 1].id : "" };
}

async function appendEvent(store, channelId, event) {
  const index = await readIndex(store, channelId);
  if (!index.some((item) => item.id === event.id)) {
    const normalized = {
      id: String(event.id).slice(0, 80),
      kind: event.kind === "test" ? "test" : "sync-complete",
      channelId,
      deviceId: String(event.deviceId).slice(0, 120),
      deviceName: String(event.deviceName || "SiYuan").slice(0, 120),
      createdAt: Number(event.createdAt),
      source: ["siyuan", "manual", "test"].includes(event.source) ? event.source : "siyuan",
    };
    await writeJson(store, eventKey(channelId, normalized.id), normalized);
    index.push({ id: normalized.id, createdAt: normalized.createdAt });
    await writeJson(store, channelIndexKey(channelId), index.slice(-MAX_EVENTS_PER_CHANNEL));
  }
}

async function handle(request) {
  if (request.method === "OPTIONS") return json({ ok: true });
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/sync/v1/")) return json({ ok: false, message: "Not found" }, 404);
  const body = request.method === "POST" ? await request.text() : "";
  const auth = await verifySignedRequest(request, body);
  if (!auth.ok) return json({ ok: false, message: auth.message }, auth.status);

  if (url.pathname === "/sync/v1/health") {
    return json({ ok: true, service: "fangcun-sync-aware-edgeone", retentionMs: RETENTION_MS });
  }

  const store = await blobStore();
  if (url.pathname === "/sync/v1/events" && request.method === "GET") {
    const result = await readEvents(store, auth.channelId, url.searchParams.get("since") || "", Math.min(Number(url.searchParams.get("limit") || 50), 100));
    return json({ ok: true, ...result });
  }

  if (url.pathname === "/sync/v1/events" && request.method === "POST") {
    const event = JSON.parse(body || "{}");
    if (!event.id || event.channelId !== auth.channelId || !event.deviceId || !event.createdAt) {
      return json({ ok: false, message: "Invalid sync awareness event." }, 400);
    }
    await appendEvent(store, auth.channelId, event);
    return json({ ok: true });
  }

  return json({ ok: false, message: "Not found" }, 404);
}

export default {
  fetch(request) {
    return handle(request).catch((error) => json({ ok: false, message: error instanceof Error ? error.message : "Internal error" }, 500));
  },
};
