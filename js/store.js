// Storage: one JSON blob in localStorage, plus export/import.

const KEY = 'today.v1';
export const MAX_CATEGORIES = 6;

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
    v: 1,
    settings: {
      dayStart: 240, // minutes after midnight (4:00 AM)
      theme: 'dark', // 'dark' | 'light' | 'system'
      haptics: true,
      sound: false,
      collapsed: {},
      lastCat: 'general',
      lastType: 'today',
    },
    categories: [{ id: 'general', name: 'General', emoji: '✅', color: 'blue' }],
    // task: { id, text, catId, type: 'daily'|'today', order, days?: number[]|null, since?: dayKey, dayKey?: dayKey }
    tasks: [],
    day: null, // { key: 'YYYY-MM-DD', done: { [taskId]: timestamp } }
    history: {}, // { 'YYYY-MM-DD': { d: done, t: total } }
    bestStreak: 0,
    carry: null, // { from: dayKey, ids: [] } unfinished one-offs offered for carry-over
  };
}

// Validates and fills in anything missing. Throws on garbage.
export function normalize(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Not a Today backup');
  const d = defaults();
  const s = { ...d, ...raw, settings: { ...d.settings, ...(raw.settings || {}) } };

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

  if (!s.history || typeof s.history !== 'object') s.history = {};
  if (s.day && (typeof s.day.key !== 'string' || typeof s.day.done !== 'object')) s.day = null;
  if (!s.settings.collapsed || typeof s.settings.collapsed !== 'object') s.settings.collapsed = {};
  delete s.app;
  delete s.exportedAt;
  return s;
}

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
