// Renders the header, progress ring and the grouped task list.
// Elements are keyed and reused so CSS transitions keep running, and moves
// are animated with FLIP (transforms only).
import { store, PALETTE } from '../store.js';
import { tasksFor, stats, daysDone, keyToDate, addDays } from '../rollover.js';
import { SPRING, reduceMotion } from './effects.js';
import { ICON, esc } from './icons.js';

const $ = (s) => document.querySelector(s);
const taskEls = new Map();
const groupEls = new Map();

export const colorOf = (id) => (PALETTE.find((p) => p.id === id) || PALETTE[5]).hex;
export const catOf = (id) => store.state.categories.find((c) => c.id === id) || store.state.categories[0];
export const taskEl = (id) => taskEls.get(id);

export const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
export const DAY_SHORT = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
export const DAY_NAME = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function render(opts) {
  renderHeader();
  renderList(opts);
}

/* ---------- header ---------- */

let shownPct = 0;
let pctRaf = 0;

function tweenPct(target) {
  cancelAnimationFrame(pctRaf);
  const el = $('#pct');
  if (reduceMotion()) {
    shownPct = target;
    el.textContent = target;
    return;
  }
  const from = shownPct;
  const t0 = performance.now();
  const step = () => {
    const k = Math.max(0, Math.min(1, (performance.now() - t0) / 700));
    const e = 1 - Math.pow(1 - k, 3);
    shownPct = Math.round(from + (target - from) * e);
    el.textContent = shownPct;
    if (k < 1) pctRaf = requestAnimationFrame(step);
  };
  pctRaf = requestAnimationFrame(step);
}

/* The day color: red with nothing done, through orange and yellow, to green at 100%. */
export function dayColor(pct) {
  const k = Math.max(0, Math.min(1, pct / 100));
  const hue = 4 + k * 128; // 4 = red, 132 = green
  const sat = 92 + k * 4;
  const light = 58 - k * 4;
  return `hsl(${hue.toFixed(1)} ${sat.toFixed(0)}% ${light.toFixed(0)}%)`;
}

const MOOD = [
  [0, "Let's go."],
  [1, 'Started.'],
  [25, 'Rolling.'],
  [50, 'Halfway there.'],
  [75, 'Almost there.'],
  [100, 'All done.'],
];
const moodFor = (pct, total) => {
  if (!total) return 'Nothing on today.';
  let m = MOOD[0][1];
  for (const [at, text] of MOOD) if (pct >= at) m = text;
  return m;
};

export function renderHeader() {
  const s = store.state;
  const d = keyToDate(s.day.key);
  $('#weekday').textContent = d.toLocaleDateString(undefined, { weekday: 'long' });
  $('#monthday').textContent = d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });

  const { done, total } = stats(s);
  const pct = total ? Math.round((done / total) * 100) : 0;
  const full = total > 0 && done === total;
  document.documentElement.style.setProperty('--accent', dayColor(pct));
  document.documentElement.classList.toggle('day-full', full);
  document.documentElement.classList.toggle('day-empty', !total);

  const bar = $('#ring-bar');
  bar.style.strokeDashoffset = String(100 - pct);
  bar.style.opacity = pct ? '1' : '0';
  $('#ring').classList.toggle('full', full);
  $('#ring').setAttribute('aria-label', `${done} of ${total} done`);
  tweenPct(pct);

  const mood = $('#mood');
  const text = moodFor(pct, total);
  if (mood.textContent !== text) {
    mood.textContent = text;
    mood.classList.remove('bump');
    void mood.offsetWidth;
    mood.classList.add('bump');
  }

  const n = daysDone(s);
  $('#days-n').textContent = n;
  $('.days-word').textContent = n === 1 ? 'day' : 'days';
  $('#days').classList.toggle('zero', n === 0);

  renderPacks();
  updateGroupCounts();
}

/* ---------- packs ---------- */

function renderPacks() {
  const s = store.state;
  const el = $('#packs');
  const onList = new Set(tasksFor(s, s.day.key).map((t) => t.text.trim().toLowerCase()));
  const html = s.packs
    .map((p) => {
      const left = p.items.filter((x) => !onList.has(x.toLowerCase())).length;
      const c = catOf(p.catId);
      return `<button type="button" class="pack${left ? '' : ' used'}" data-id="${p.id}" style="--c:${colorOf(c.color)}" aria-label="Add ${esc(p.name)}">
        <span class="pack-emoji">${esc(p.emoji)}</span><span class="pack-name">${esc(p.name)}</span>
        <span class="pack-n">${left ? `+${left}` : ICON.check}</span></button>`;
    })
    .join('');
  if (el.dataset.html !== html) {
    el.dataset.html = html;
    el.innerHTML = html;
  }
  el.hidden = !s.packs.length;
}

/* ---------- list ---------- */

function createGroup(id) {
  const g = document.createElement('section');
  g.className = 'group';
  g.dataset.cat = id;
  g.innerHTML = `<button class="group-head" type="button">
      <span class="g-emoji"></span><span class="g-name"></span><span class="g-count"></span>${ICON.chev}
    </button>
    <div class="group-body"><div class="group-inner">
      <button class="add-inline" type="button"><span class="ai-plus">${ICON.plus}</span><span class="ai-text"></span></button>
      <ul class="tasks"></ul>
    </div></div>`;
  return g;
}

function updateGroup(g, c, list) {
  const s = store.state;
  g.style.setProperty('--c', colorOf(c.color));
  g.querySelector('.g-emoji').textContent = c.emoji;
  g.querySelector('.g-name').textContent = c.name;
  g.querySelector('.ai-text').textContent = `Add to ${c.name}`;
  g.querySelector('.add-inline').setAttribute('aria-label', `Add a task to ${c.name} for today`);
  const collapsed = !!s.settings.collapsed[c.id];
  g.classList.toggle('collapsed', collapsed);
  g.querySelector('.group-head').setAttribute('aria-expanded', String(!collapsed));
  setCount(g, list);
}

function setCount(g, list) {
  const done = list.filter((t) => store.state.day.done[t.id]).length;
  const el = g.querySelector('.g-count');
  el.textContent = `${done}/${list.length}`;
  el.classList.toggle('complete', done === list.length);
}

function updateGroupCounts() {
  const visible = tasksFor(store.state, store.state.day.key);
  groupEls.forEach((g, id) => setCount(g, visible.filter((t) => t.catId === id)));
}

function createTask(id) {
  const li = document.createElement('li');
  li.className = 'task';
  li.dataset.id = id;
  li.innerHTML = `<div class="swipe-bg"><span class="sb sb-done">${ICON.check}</span><span class="sb sb-del">${ICON.trash}</span></div>
    <div class="task-fg">
      <button class="check" type="button">
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <circle class="check-ring" cx="16" cy="16" r="13"/>
          <circle class="check-fill" cx="16" cy="16" r="14.4"/>
          <path class="tick" pathLength="1" d="M10 16.6l4.1 4.1 8-8.4"/>
        </svg>
      </button>
      <div class="task-body" data-haptic><span class="task-text"></span><span class="task-meta"></span></div>
    </div>`;
  return li;
}

function metaFor(t) {
  if (t.type !== 'daily') return '';
  const days = !t.days || t.days.length === 7 ? 'Daily' : DAY_ORDER.filter((d) => t.days.includes(d)).map((d) => DAY_NAME[d]).join(' · ');
  return `↻ ${days}`;
}

function updateTask(li, t, c) {
  const done = !!store.state.day.done[t.id];
  li.style.setProperty('--c', colorOf(c.color));
  li.classList.toggle('done', done);
  const text = li.querySelector('.task-text');
  if (text.textContent !== t.text) text.textContent = t.text;
  li.querySelector('.task-meta').textContent = metaFor(t);
  const btn = li.querySelector('.check');
  btn.setAttribute('aria-label', `${done ? 'Uncheck' : 'Complete'} ${t.text}`);
  btn.setAttribute('aria-pressed', String(done));
}

function placeAfter(parent, el, prev) {
  const ref = prev ? prev.nextSibling : parent.firstChild;
  if (el !== ref) parent.insertBefore(el, ref);
}

export function renderList({ animate = false, clearTransforms = false } = {}) {
  const s = store.state;
  const done = s.day.done;
  const before = animate && !reduceMotion() ? snapshot() : null;

  if (clearTransforms) {
    taskEls.forEach((li) => {
      li.style.transform = '';
      li.style.transition = '';
    });
  }

  const visible = tasksFor(s, s.day.key);
  const root = $('#groups');
  const seenT = new Set();
  const seenG = new Set();
  let prevG = null;

  for (const c of s.categories) {
    const list = visible.filter((t) => t.catId === c.id);
    if (!list.length) continue;
    list.sort((a, b) => !!done[a.id] - !!done[b.id] || a.order - b.order);

    let g = groupEls.get(c.id);
    if (!g) {
      g = createGroup(c.id);
      groupEls.set(c.id, g);
    }
    updateGroup(g, c, list);
    placeAfter(root, g, prevG);
    prevG = g;
    seenG.add(c.id);

    const ul = g.querySelector('.tasks');
    let prevT = null;
    for (const t of list) {
      let li = taskEls.get(t.id);
      if (!li) {
        li = createTask(t.id);
        taskEls.set(t.id, li);
      }
      updateTask(li, t, c);
      placeAfter(ul, li, prevT);
      prevT = li;
      seenT.add(t.id);
    }
  }

  for (const [id, li] of taskEls) if (!seenT.has(id)) { li.remove(); taskEls.delete(id); }
  for (const [id, g] of groupEls) if (!seenG.has(id)) { g.remove(); groupEls.delete(id); }

  renderEmpty(visible);
  renderCarry();
  if (before) flip(before);
}

function snapshot() {
  const m = new Map();
  taskEls.forEach((li) => li.isConnected && m.set(li, li.getBoundingClientRect().top));
  groupEls.forEach((g) => g.isConnected && m.set(g, g.getBoundingClientRect().top));
  return m;
}

function flip(before) {
  const gDelta = new Map();
  groupEls.forEach((g) => {
    const old = before.get(g);
    if (old == null) {
      g.animate([{ opacity: 0, transform: 'scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: SPRING });
      gDelta.set(g, null);
      return;
    }
    const d = old - g.getBoundingClientRect().top;
    gDelta.set(g, d);
    if (Math.abs(d) > 0.5) slide(g, d);
  });
  taskEls.forEach((li) => {
    const gd = gDelta.get(li.closest('.group'));
    if (gd === null) return; // whole group is entering
    const old = before.get(li);
    if (old == null) {
      li.animate([{ opacity: 0, transform: 'scale(.94)' }, { opacity: 1, transform: 'none' }], { duration: 440, easing: SPRING });
      return;
    }
    const d = old - li.getBoundingClientRect().top - (gd || 0);
    if (Math.abs(d) > 0.5) slide(li, d);
  });
}

function slide(el, d) {
  el.animate([{ transform: `translateY(${d}px)` }, { transform: 'none' }], { duration: 560, easing: SPRING });
}

function renderEmpty(visible) {
  const el = $('#empty');
  if (visible.length) {
    el.hidden = true;
    el.dataset.kind = '';
    return;
  }
  const kind = store.state.tasks.some((t) => t.type === 'daily') ? 'free' : 'first';
  el.hidden = false;
  if (el.dataset.kind === kind) return;
  el.dataset.kind = kind;
  el.innerHTML =
    kind === 'free'
      ? `<div class="empty-emoji">🌤️</div><h2>Free day.</h2><p>Nothing scheduled today.<br>Tap a pack above or <b>+</b> if something comes up.</p>`
      : `<div class="empty-emoji">✨</div><h2>A fresh start.</h2><p>Tap a pack above or <b>+</b> to add your first task.</p>`;
}

function renderCarry() {
  const s = store.state;
  const el = $('#carry');
  const ids = s.carry ? s.carry.ids.filter((id) => s.tasks.some((t) => t.id === id)) : [];
  if (!ids.length) {
    el.innerHTML = '';
    return;
  }
  if (el.dataset.n === String(ids.length) && el.firstChild) return;
  el.dataset.n = ids.length;
  const when = s.carry.from === addDays(s.day.key, -1) ? 'yesterday' : `from ${DAY_NAME[keyToDate(s.carry.from).getDay()]}`;
  el.innerHTML = `<div class="carry">
      <div class="carry-text"><b>${ids.length} unfinished</b>${esc(when)}</div>
      <button class="carry-yes" type="button">Carry to today</button>
      <button class="carry-no" type="button" aria-label="Dismiss">✕</button>
    </div>`;
}
