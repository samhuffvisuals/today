// Day logic. PWAs can't run in the background, so this runs on open,
// on visibility change, and on a timer while the app is in front.

const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// The "logical" day: with a 4:00 AM start, 1:30 AM still belongs to yesterday.
export function dayKey(date, dayStartMin) {
  return fmt(new Date(date.getTime() - dayStartMin * 60000));
}

export function keyToDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

export function addDays(key, n) {
  const d = keyToDate(key);
  d.setDate(d.getDate() + n);
  return fmt(d);
}

export const weekday = (key) => keyToDate(key).getDay(); // 0 = Sunday

export function isScheduled(task, key) {
  if (task.type === 'daily') {
    if (task.since && key < task.since) return false;
    return !task.days || task.days.length === 0 || task.days.includes(weekday(key));
  }
  return task.dayKey === key;
}

export const tasksFor = (state, key) => state.tasks.filter((t) => isScheduled(t, key));

export function stats(state) {
  const list = tasksFor(state, state.day.key);
  const done = list.filter((t) => state.day.done[t.id]).length;
  return { done, total: list.length };
}

/**
 * Rolls the state forward to the current logical day.
 * Saves yesterday to history, fills skipped days, cleans up one-off tasks
 * and queues unfinished ones for the "Carry to today?" prompt.
 */
export function rollover(state, now = new Date()) {
  const key = dayKey(now, state.settings.dayStart);
  if (!state.day) {
    state.day = { key, done: {} };
    return { changed: true };
  }
  if (state.day.key === key) return { changed: false };

  // Clock moved backwards (or "day starts at" changed): adopt the new key, keep progress.
  if (key < state.day.key) {
    state.day.key = key;
    return { changed: true };
  }

  const prev = state.day.key;
  const s = stats(state);
  // Keep the day's list too, so it can be looked at and copied later.
  const list = tasksFor(state, prev).map((t) => ({ text: t.text, catId: t.catId, done: !!state.day.done[t.id], daily: t.type === 'daily' }));
  state.history[prev] = { d: s.done, t: s.total, tasks: list };

  // Days the app was never opened count as 0% for whatever daily tasks were scheduled.
  let k = addDays(prev, 1);
  for (let guard = 0; k < key && guard < 90; guard++, k = addDays(k, 1)) {
    const t = state.tasks.filter((x) => x.type === 'daily' && isScheduled(x, k)).length;
    state.history[k] = { d: 0, t };
  }

  const unfinished = state.tasks.filter((t) => t.type === 'today' && t.dayKey === prev && !state.day.done[t.id]);
  const keepIds = new Set(unfinished.map((t) => t.id));
  state.tasks = state.tasks.filter((t) => t.type === 'daily' || t.dayKey >= key || keepIds.has(t.id));
  state.carry = unfinished.length ? { from: prev, ids: [...keepIds] } : null;

  state.day = { key, done: {} };

  const cutoff = addDays(key, -400);
  for (const hk of Object.keys(state.history)) if (hk < cutoff) delete state.history[hk];

  return { changed: true };
}

// Days finished, all time. Only ever counts up: a missed day adds nothing and takes nothing away.
export function daysDone(state) {
  let n = 0;
  for (const h of Object.values(state.history)) if (h.t > 0 && h.d >= h.t) n++;
  const s = stats(state);
  if (s.total > 0 && s.done === s.total) n++;
  return n;
}

// Tasks checked off over the last `days` days, today included.
export function tasksDone(state, days = 30) {
  let n = stats(state).done;
  const from = addDays(state.day.key, -(days - 1));
  for (const [k, h] of Object.entries(state.history)) if (k >= from && k < state.day.key) n += h.d;
  return n;
}
