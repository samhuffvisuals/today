// Sync between devices through a private GitHub gist.
//
// Each device keeps working offline from its own copy (localStorage). When it syncs it
// reads the gist, merges it with the local copy, saves the result on both sides, and
// remembers that result as the "base" for next time. Comparing each side with the base
// shows what each device changed, so edits made on the phone and the Mac in the same
// stretch are combined task by task instead of one copy replacing the other.
import { store, normalize } from './store.js';
import { rollover } from './rollover.js';
import { render } from './ui/render.js';
import { gestureBusy } from './ui/gestures.js';
import { sheetOpen } from './ui/sheets.js';

const CONF_KEY = 'today.sync';
const BASE_KEY = 'today.sync.base';
const FILE = 'today.json';
const DESC = 'Today app sync (used by the Today app; please don’t edit)';
const API = 'https://api.github.com';

/* ---------- settings kept on this device only ---------- */

function readJSON(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}
function writeJSON(key, v) {
  try {
    if (v == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(v));
  } catch {}
}

// { token, gistId, login, last?: ms, error?: string }
let conf = readJSON(CONF_KEY);
const saveConf = () => writeJSON(CONF_KEY, conf);

export const syncConf = () => conf;
export const syncOn = () => !!(conf && conf.token && conf.gistId);

const listeners = new Set();
export const onSyncStatus = (fn) => (listeners.add(fn), () => listeners.delete(fn));
let busy = false;
const notify = () => listeners.forEach((fn) => fn({ busy, conf }));

/* ---------- GitHub ---------- */

async function gh(path, { method = 'GET', body, token = conf?.token } = {}) {
  const res = await fetch(API + path, {
    method,
    cache: 'no-store',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) throw new Error('GitHub didn’t accept the key. It may have expired: make a new one.');
  if (res.status === 403 || res.status === 404) {
    const msg = path.startsWith('/gists') ? 'The key can’t reach gists. Make a key with the “gist” box ticked.' : `GitHub said ${res.status}`;
    throw new Error(msg);
  }
  if (!res.ok) throw new Error(`GitHub said ${res.status}`);
  return res.status === 204 ? null : res.json();
}

async function readGist(id, token) {
  const g = await gh(`/gists/${id}`, { token });
  const f = g.files?.[FILE];
  if (!f) return null;
  let text = f.content;
  if (f.truncated && f.raw_url) text = await (await fetch(f.raw_url, { cache: 'no-store' })).text();
  return JSON.parse(text);
}

const writeGist = (id, state) =>
  gh(`/gists/${id}`, { method: 'PATCH', body: { files: { [FILE]: { content: JSON.stringify(state) } } } });

async function findGist(token) {
  for (let page = 1; page <= 5; page++) {
    const list = await gh(`/gists?per_page=100&page=${page}`, { token });
    const hit = list.find((g) => g.description === DESC && g.files?.[FILE]);
    if (hit) return hit.id;
    if (list.length < 100) break;
  }
  return null;
}

/* ---------- connect / disconnect ---------- */

// Returns { created: bool } — created means this device's tasks started the synced copy;
// otherwise this device switched to the tasks already synced from another one.
export async function connect(token) {
  token = token.trim();
  const user = await gh('/user', { token });
  let gistId = await findGist(token);
  let created = false;
  if (gistId) {
    const remote = await readGist(gistId, token);
    if (remote) {
      store.state = normalize(remote);
      rollover(store.state);
      store.save({ quiet: true });
      writeJSON(BASE_KEY, remote);
      render({ animate: true });
    }
  } else {
    const g = await gh('/gists', {
      method: 'POST',
      token,
      body: { description: DESC, public: false, files: { [FILE]: { content: JSON.stringify(store.state) } } },
    });
    gistId = g.id;
    created = true;
    writeJSON(BASE_KEY, JSON.parse(JSON.stringify(store.state)));
  }
  conf = { token, gistId, login: user.login, last: Date.now() };
  saveConf();
  notify();
  return { created };
}

export function disconnect() {
  conf = null;
  saveConf();
  writeJSON(BASE_KEY, null);
  clearTimeout(pushTimer);
  notify();
}

/* ---------- merging ---------- */

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isKeyed = (a) => Array.isArray(a) && a.every((x) => isObj(x) && x.id != null);

function eq(a, b) {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => eq(x, b[i]));
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a).filter((k) => a[k] !== undefined);
    const kb = Object.keys(b).filter((k) => b[k] !== undefined);
    return ka.length === kb.length && ka.every((k) => eq(a[k], b[k]));
  }
  return false;
}

// Three-way merge: what changed on this device (l) and on the other (r) since base.
// Both changed the same plain value: this device wins. One side deleted something the
// other edited: the edit wins.
export function merge(base, l, r) {
  if (eq(l, r)) return l;
  if (eq(l, base)) return r;
  if (eq(r, base)) return l;
  if (l === undefined) return r;
  if (r === undefined) return l;
  if (isObj(l) && isObj(r)) {
    const b = isObj(base) ? base : {};
    const out = {};
    for (const k of new Set([...Object.keys(l), ...Object.keys(r)])) {
      const v = merge(b[k], l[k], r[k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  if (isKeyed(l) && isKeyed(r)) return mergeKeyed(isKeyed(base) ? base : [], l, r);
  return l;
}

// Lists of things with ids (tasks, steps, categories, packs): merged item by item.
function mergeKeyed(base, l, r) {
  const bm = new Map(base.map((x) => [x.id, x]));
  const lm = new Map(l.map((x) => [x.id, x]));
  const rm = new Map(r.map((x) => [x.id, x]));
  const merged = new Map();
  for (const id of new Set([...lm.keys(), ...rm.keys()])) {
    const v = merge(bm.get(id), lm.get(id), rm.get(id));
    if (v !== undefined) merged.set(id, v);
  }
  // Order: if only the other device reordered, use its order. New items from the
  // other device go right after the item they follow there.
  const ids = (a) => a.map((x) => x.id).join('\n');
  const primary = ids(l) === ids(base) ? r : l;
  const secondary = primary === r ? l : r;
  const order = primary.map((x) => x.id).filter((id) => merged.has(id));
  secondary.forEach((x, i) => {
    if (!merged.has(x.id) || order.includes(x.id)) return;
    const prev = secondary.slice(0, i).reverse().find((y) => order.includes(y.id));
    order.splice(prev ? order.indexOf(prev.id) + 1 : 0, 0, x.id);
  });
  return order.map((id) => merged.get(id));
}

// The day ("done" ticks) and carry-over belong to one date. If the two copies are on
// different days, the later day's copy wins outright: never merge yesterday's ticks into today.
function mergeState(base, l, r) {
  const ld = l.day?.key || '';
  const rd = r.day?.key || '';
  if (ld !== rd) {
    const newer = ld > rd ? l : r;
    const m = merge(base && { ...base, day: null, carry: null }, { ...l, day: null, carry: null }, { ...r, day: null, carry: null });
    return { ...m, day: newer.day, carry: newer.carry ?? null };
  }
  return merge(base, l, r);
}

/* ---------- syncing ---------- */

let pushTimer = 0;
let again = false;

// Sync soon after a change, once things have settled.
export function scheduleSync(delay = 1500) {
  if (!syncOn()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => syncNow(), delay);
}

// Never swap the data out from under an open sheet or a finger mid-drag: they hold
// references to the current tasks. Try again shortly instead.
const unsafe = () => sheetOpen() || gestureBusy();

export async function syncNow({ force = false } = {}) {
  if (!syncOn()) return;
  if (busy) {
    again = true;
    return;
  }
  if (!force && unsafe()) return scheduleSync(3000);
  if (!navigator.onLine) return;
  busy = true;
  notify();
  try {
    const remote = await readGist(conf.gistId);
    if (!force && unsafe()) {
      busy = false;
      return scheduleSync(3000);
    }
    const local = JSON.parse(JSON.stringify(store.state));
    const base = readJSON(BASE_KEY);
    let merged = remote ? mergeState(base, local, remote) : local;
    merged = normalize(merged);
    rollover(merged);
    if (!eq(merged, local)) {
      store.state = merged;
      store.save({ quiet: true });
      render({ animate: true });
    }
    if (!remote || !eq(merged, remote)) await writeGist(conf.gistId, merged);
    writeJSON(BASE_KEY, merged);
    conf.last = Date.now();
    delete conf.error;
  } catch (e) {
    if (conf) conf.error = e.message || 'Couldn’t sync';
    console.warn('Sync failed', e);
  } finally {
    saveConf();
    busy = false;
    notify();
    if (again) {
      again = false;
      scheduleSync(300);
    }
  }
}

export function initSync() {
  store.onSave = () => scheduleSync();
  syncNow();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) syncNow();
    else if (pushTimer) {
      // Leaving the app with a change waiting: send it now.
      clearTimeout(pushTimer);
      pushTimer = 0;
      syncNow();
    }
  });
  window.addEventListener('online', () => syncNow());
  // Pick up changes from the other device while this one sits open.
  setInterval(() => !document.hidden && syncNow(), 45000);
}
