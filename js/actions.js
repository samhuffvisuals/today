// State changes + the feedback (haptics, effects) that goes with them.
// Each one is called synchronously from a gesture handler so haptics can fire.
import { store, uid, remember, MAX_CATEGORIES, MAX_PACKS } from './store.js';
import { stats, tasksFor } from './rollover.js';
import { haptic } from './haptics.js';
import { renderHeader, renderList, render, taskEl, colorOf, catOf } from './ui/render.js';
import { burst, celebrate } from './ui/effects.js';
import { toast } from './ui/toast.js';
import { gestureBusy } from './ui/gestures.js';

let listTimer = 0;
// Let the check animation play, then slide the task to the bottom of its group.
function queueReorder(delay = 480) {
  clearTimeout(listTimer);
  listTimer = setTimeout(() => (gestureBusy() ? queueReorder(250) : renderList({ animate: true })), delay);
}

export function toggleTask(id) {
  const s = store.state;
  const t = s.tasks.find((x) => x.id === id);
  if (!t) return;
  const was = !!s.day.done[id];
  if (was) delete s.day.done[id];
  else s.day.done[id] = Date.now();
  store.save();

  const st = stats(s);
  const allDone = !was && st.total > 0 && st.done === st.total;
  haptic(was ? 'tap' : allDone ? 'celebrate' : 'success');

  const li = taskEl(id);
  if (li) {
    li.classList.toggle('done', !was);
    if (!was) {
      li.classList.remove('pop');
      void li.offsetWidth;
      li.classList.add('pop');
      const r = li.querySelector('.check').getBoundingClientRect();
      burst(r.left + r.width / 2, r.top + r.height / 2, colorOf(catOf(t.catId).color));
    }
  }
  renderHeader();
  queueReorder();
  if (allDone) setTimeout(() => celebrate(), 380);
}

function nextOrder(s) {
  return s.tasks.reduce((m, t) => Math.max(m, t.order || 0), 0) + 1;
}

export function addTask(text, { catId, type, days }) {
  const s = store.state;
  const t = { id: uid(), text, catId, type, order: nextOrder(s) };
  if (type === 'daily') {
    t.days = days && days.length && days.length < 7 ? [...days] : null;
    t.since = s.day.key;
  } else {
    t.dayKey = s.day.key;
  }
  s.tasks.push(t);
  remember(s, text, catId);
  s.settings.lastCat = catId;
  s.settings.lastType = type;
  store.save();
  haptic('tap');
  renderHeader();
  renderList({ animate: true });
  return t;
}

// Drops every item of a pack onto today (skipping ones already on the list). Returns how many were added.
export function addPack(packId) {
  const s = store.state;
  const p = s.packs.find((x) => x.id === packId);
  if (!p) return 0;
  const onList = new Set(tasksFor(s, s.day.key).map((t) => t.text.trim().toLowerCase()));
  let order = nextOrder(s);
  let n = 0;
  for (const text of p.items) {
    if (onList.has(text.toLowerCase())) continue;
    s.tasks.push({ id: uid(), text, catId: p.catId, type: 'today', order: order++, dayKey: s.day.key });
    remember(s, text, p.catId);
    onList.add(text.toLowerCase());
    n++;
  }
  if (!n) {
    haptic('snap');
    toast(`${p.emoji} ${p.name} is already on today`);
    return 0;
  }
  delete s.settings.collapsed[p.catId];
  store.save();
  haptic('success');
  render({ animate: true });
  toast(`${p.emoji} Added ${n} ${n === 1 ? 'task' : 'tasks'}`);
  return n;
}

export function editTask(id, { text, catId, type, days }) {
  const s = store.state;
  const t = s.tasks.find((x) => x.id === id);
  if (!t) return;
  if (t.text !== text) remember(s, text, catId);
  t.text = text;
  t.catId = catId;
  if (type === 'daily') {
    if (t.type !== 'daily') t.since = s.day.key;
    t.days = days && days.length && days.length < 7 ? [...days] : null;
    delete t.dayKey;
  } else {
    t.dayKey = s.day.key;
    delete t.days;
    delete t.since;
  }
  t.type = type;
  store.save();
  render({ animate: true });
}

export function deleteTask(id) {
  const s = store.state;
  const idx = s.tasks.findIndex((x) => x.id === id);
  if (idx < 0) return;
  const [task] = s.tasks.splice(idx, 1);
  const doneAt = s.day.done[id];
  delete s.day.done[id];
  store.save();
  render({ animate: true });

  const label = task.text.length > 24 ? task.text.slice(0, 23) + '…' : task.text;
  toast(`Deleted “${label}”`, {
    action: 'Undo',
    onAction() {
      const st = store.state;
      st.tasks.splice(Math.min(idx, st.tasks.length), 0, task);
      if (doneAt) st.day.done[id] = doneAt;
      store.save();
      haptic('tap');
      render({ animate: true });
    },
  });
}

// ids: the new on-screen order of one category's visible tasks.
// They swap order "slots" among themselves so hidden tasks keep their place.
export function reorder(ids) {
  const s = store.state;
  const byId = new Map(s.tasks.map((t) => [t.id, t]));
  const items = ids.map((id) => byId.get(id)).filter(Boolean);
  const slots = items.map((t) => t.order).sort((a, b) => a - b);
  items.forEach((t, i) => (t.order = slots[i]));
  store.save();
  renderList({ animate: true, clearTransforms: true });
}

export function carryTasks() {
  const s = store.state;
  if (!s.carry) return;
  for (const t of s.tasks) if (s.carry.ids.includes(t.id)) t.dayKey = s.day.key;
  s.carry = null;
  store.save();
  haptic('success');
  render({ animate: true });
}

export function dismissCarry() {
  const s = store.state;
  if (!s.carry) return;
  const ids = new Set(s.carry.ids);
  s.tasks = s.tasks.filter((t) => !ids.has(t.id));
  s.carry = null;
  store.save();
  haptic('tap');
  render({ animate: true });
}

export function toggleCollapse(catId) {
  const c = store.state.settings.collapsed;
  if (c[catId]) delete c[catId];
  else c[catId] = true;
  store.save();
  haptic('tap');
  renderList();
}

export function saveCategory({ id, name, emoji, color }) {
  const s = store.state;
  let c = id && s.categories.find((x) => x.id === id);
  if (c) Object.assign(c, { name, emoji, color });
  else {
    if (s.categories.length >= MAX_CATEGORIES) return null;
    c = { id: uid(), name, emoji, color };
    s.categories.push(c);
  }
  store.save();
  haptic('success');
  render({ animate: true });
  return c;
}

export function deleteCategory(id) {
  const s = store.state;
  if (id === 'general') return;
  s.categories = s.categories.filter((c) => c.id !== id);
  for (const t of s.tasks) if (t.catId === id) t.catId = 'general';
  for (const p of s.packs) if (p.catId === id) p.catId = 'general';
  delete s.settings.collapsed[id];
  if (s.settings.lastCat === id) s.settings.lastCat = 'general';
  store.save();
  haptic('tap');
  render({ animate: true });
}

export function savePack({ id, name, emoji, catId, items }) {
  const s = store.state;
  let p = id && s.packs.find((x) => x.id === id);
  if (p) {
    // Moving the pack to another group takes today's tasks that came from it along.
    if (p.catId !== catId) {
      const names = new Set(items.map((x) => x.trim().toLowerCase()));
      for (const t of s.tasks) {
        if (t.type === 'today' && t.dayKey === s.day.key && t.catId === p.catId && names.has(t.text.trim().toLowerCase())) t.catId = catId;
      }
    }
    Object.assign(p, { name, emoji, catId, items: [...items] });
  } else {
    if (s.packs.length >= MAX_PACKS) return null;
    p = { id: uid(), name, emoji, catId, items: [...items] };
    s.packs.push(p);
  }
  store.save();
  haptic('success');
  render({ animate: true });
  return p;
}

export function deletePack(id) {
  const s = store.state;
  s.packs = s.packs.filter((p) => p.id !== id);
  store.save();
  haptic('tap');
  render();
}
