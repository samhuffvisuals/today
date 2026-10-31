// Storage: one JSON blob in localStorage, plus export/import and first-run seeding.

const KEY = 'today.v1';
export const MAX_CATEGORIES = 6;
export const MAX_PACKS = 8;

// Curated palette. Ticks on top of these are drawn in black, which reads well on all eight.
export const PALETTE = [
  { id: 'red', hex: '#FF453A' },
  { id: 'orange', hex: '#FF9F0A' },
  { id: 'yellow', hex: '#FFD60A' },
  { id: 'green', hex: '#30D158' },
  { id: 'teal', hex: '#64D2FF' },
  { id: 'blue', hex: '#0A84FF' },
  { id: 'purple', hex: '#BF5AF2' },
  { id: 'pink', hex: '#FF375F' },
];

export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

function defaults() {
  return {
    v: 2,
    settings: {
      dayStart: 240, // minutes after midnight (4:00 AM)
      haptics: true,
      collapsed: {},
      lastCat: 'general',
      lastType: 'today',
    },
    categories: [{ id: 'general', name: 'General', emoji: '✅', color: 'blue' }],
    // task: { id, text, catId, type: 'daily'|'today', order, days?: number[]|null, since?: dayKey, dayKey?: dayKey }
    tasks: [],
    // pack: { id, name, emoji, catId, items: string[] } — one tap drops every item onto today
    packs: [],
    day: null, // { key: 'YYYY-MM-DD', done: { [taskId]: timestamp } }
    history: {}, // { 'YYYY-MM-DD': { d: done, t: total } }
    seeded: 0, // which starter set has been applied
    carry: null, // { from: dayKey, ids: [] } unfinished one-offs offered for carry-over
  };
}

// Validates and fills in anything missing. Throws on garbage.
export function normalize(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Not a Today backup');
  const d = defaults();
  const s = { ...d, ...raw, settings: { ...d.settings, ...(raw.settings || {}) } };
  delete s.settings.theme;
  delete s.settings.sound;
  delete s.bestStreak;

  if (!Array.isArray(s.categories)) s.categories = [];
  s.categories = s.categories.filter((c) => c && c.id && typeof c.name === 'string');
  if (!s.categories.some((c) => c.id === 'general')) s.categories.unshift(d.categories[0]);
  s.categories = s.categories.slice(0, MAX_CATEGORIES);
  const catIds = new Set(s.categories.map((c) => c.id));

  if (!Array.isArray(s.tasks)) s.tasks = [];
  s.tasks = s.tasks
    .filter((t) => t && t.id && typeof t.text === 'string')
    .map((t, i) => ({
      ...t,
      type: t.type === 'daily' ? 'daily' : 'today',
      catId: catIds.has(t.catId) ? t.catId : 'general',
      order: Number.isFinite(t.order) ? t.order : i,
    }));

  if (!Array.isArray(s.packs)) s.packs = [];
  s.packs = s.packs
    .filter((p) => p && p.id && typeof p.name === 'string')
    .map((p) => ({
      id: p.id,
      name: p.name,
      emoji: typeof p.emoji === 'string' && p.emoji ? p.emoji : '📦',
      catId: catIds.has(p.catId) ? p.catId : 'general',
      items: Array.isArray(p.items) ? p.items.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : [],
    }))
    .slice(0, MAX_PACKS);

  if (!s.history || typeof s.history !== 'object') s.history = {};
  if (s.day && (typeof s.day.key !== 'string' || typeof s.day.done !== 'object')) s.day = null;
  if (!s.settings.collapsed || typeof s.settings.collapsed !== 'object') s.settings.collapsed = {};
  s.seeded = Number.isFinite(s.seeded) ? s.seeded : 0;
  delete s.app;
  delete s.exportedAt;
  return s;
}

/* ---------- starter set ---------- */

const SEED_VERSION = 1;

const SEED = {
  categories: [
    { key: 'work', name: 'Work', emoji: '🎬', color: 'purple' },
    { key: 'home', name: 'Home', emoji: '🏠', color: 'teal' },
  ],
  daily: [
    { cat: 'home', text: 'Feed Lucky' },
    { cat: 'home', text: 'Take Lucky out' },
    { cat: 'home', text: 'Dishes' },
    { cat: 'home', text: 'Shower' },
  ],
  packs: [
    {
      cat: 'work',
      name: 'New shoot',
      emoji: '🎬',
      items: ['Download footage', 'Upload footage', 'Sort footage', 'Create project', 'Transcribe footage', 'Find song', 'Find inspo video', 'Brainstorm ideas'],
    },
    { cat: 'home', name: 'Clean house', emoji: '🧹', items: ['Clean living room', 'Vacuum', 'Take trash out', 'Laundry'] },
    { cat: 'home', name: 'Trip', emoji: '✈️', items: ['Pack for trip', 'Clean car', 'Laundry'] },
  ],
};

const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

// Adds the starter categories, daily tasks and packs once, without duplicating anything already there.
export function seed(state, dayKey) {
  if (state.seeded >= SEED_VERSION) return false;
  const catFor = {};
  for (const c of SEED.categories) {
    let found = state.categories.find((x) => same(x.name, c.name));
    if (!found && state.categories.length < MAX_CATEGORIES) {
      found = { id: uid(), name: c.name, emoji: c.emoji, color: c.color };
      state.categories.push(found);
    }
    catFor[c.key] = found ? found.id : 'general';
  }
  let order = state.tasks.reduce((m, t) => Math.max(m, t.order || 0), 0);
  for (const t of SEED.daily) {
    if (state.tasks.some((x) => same(x.text, t.text))) continue;
    state.tasks.push({ id: uid(), text: t.text, catId: catFor[t.cat], type: 'daily', order: ++order, days: null, since: dayKey });
  }
  for (const p of SEED.packs) {
    if (state.packs.some((x) => same(x.name, p.name)) || state.packs.length >= MAX_PACKS) continue;
    state.packs.push({ id: uid(), name: p.name, emoji: p.emoji, catId: catFor[p.cat], items: [...p.items] });
  }
  state.seeded = SEED_VERSION;
  return true;
}

/* ---------- persistence ---------- */

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch (e) {
    console.warn('Could not read saved data, starting fresh', e);
  }
  return defaults();
}

export const store = {
  state: load(),
  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(store.state));
    } catch (e) {
      console.warn('Save failed', e);
    }
  },
};

export function exportData() {
  return JSON.stringify({ app: 'today', exportedAt: new Date().toISOString(), ...store.state }, null, 2);
}

export function importData(text) {
  store.state = normalize(JSON.parse(text));
  store.save();
}

export function eraseAll() {
  try { localStorage.removeItem(KEY); } catch {}
  store.state = defaults();
}
