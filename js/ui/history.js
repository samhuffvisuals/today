// Your days: a calendar of wins. Days you finished are solid, days you made progress
// are tinted, and everything else is just blank. Nothing here counts against you.
import { store } from '../store.js';
import { addDays, keyToDate, stats, daysDone, tasksDone, tasksFor, weekday } from '../rollover.js';
import { openSheet } from './sheets.js';
import { haptic } from '../haptics.js';
import { DAY_ORDER, DAY_SHORT, catOf, colorOf } from './render.js';
import { copyTasks } from '../actions.js';
import { ICON, esc } from './icons.js';

const DAYS = 35; // five weeks

export function openHistory() {
  const s = store.state;
  const today = s.day.key;
  const start = addDays(today, -(DAYS - 1));
  const gridStart = addDays(start, -((weekday(start) + 6) % 7)); // back to Monday
  const gridEnd = addDays(today, (7 - weekday(today)) % 7); // forward to Sunday

  const dayData = (k) => {
    if (k === today) {
      const st = stats(s);
      return { d: st.done, t: st.total, tasks: tasksFor(s, today).map((t) => ({ text: t.text, catId: t.catId, done: !!s.day.done[t.id], daily: t.type === 'daily' })) };
    }
    return s.history[k] || null;
  };

  let cells = '';
  let won = 0;
  for (let k = gridStart; k <= gridEnd; k = addDays(k, 1)) {
    if (k < start || k > today) {
      cells += `<span class="cell out"></span>`;
      continue;
    }
    const h = dayData(k);
    let cls = 'cell';
    let style = '';
    if (h?.tasks?.length) cls += ' has';
    if (h && h.t > 0 && h.d > 0) {
      const pct = h.d / h.t;
      if (pct >= 1) {
        won++;
        cls += ' perfect';
      } else style = `--m:${Math.round(18 + pct * 55)}%`;
    }
    if (k === today) cls += ' today';
    cells += `<button type="button" class="${cls}" style="${style}" data-k="${k}" aria-label="${k}">${keyToDate(k).getDate()}</button>`;
  }

  const total = daysDone(s);
  const tasks = tasksDone(s, DAYS);
  const sheet = openSheet({
    title: 'Your days',
    className: 'hist-sheet',
    content: `
      <div class="hist-stats">
        <div class="stat"><b>${total}</b><span>${total === 1 ? 'day' : 'days'} done, all time</span></div>
        <div class="stat"><b>${tasks}</b><span>${tasks === 1 ? 'task' : 'tasks'} done, five weeks</span></div>
      </div>
      <div class="hist-grid">
        ${DAY_ORDER.map((d) => `<span class="hist-dow">${DAY_SHORT[d]}</span>`).join('')}
        ${cells}
      </div>
      <p class="hist-detail">${won ? `${won} ${won === 1 ? 'day' : 'days'} finished in the last five weeks` : 'Tap a day'}</p>
      <div class="day-panel" data-role="day" hidden></div>`,
  });

  // Tapping a day shows what was on it. Older days get a picker to copy tasks onto today.
  const panel = sheet.$('[data-role=day]');
  let picked = new Set();
  const onToday = new Set(tasksFor(s, today).map((t) => t.text.trim().toLowerCase()));
  const showDay = (k) => {
    const h = dayData(k);
    const list = h?.tasks || [];
    if (!list.length) {
      panel.hidden = true;
      panel.innerHTML = '';
      return;
    }
    const isToday = k === today;
    picked = new Set(list.map((_, i) => i).filter((i) => !isToday && !onToday.has(list[i].text.trim().toLowerCase())));
    panel.hidden = false;
    panel.innerHTML = `
      <ul class="day-tasks">${list
        .map((t, i) => {
          const c = catOf(t.catId);
          const here = onToday.has(t.text.trim().toLowerCase());
          return `<li><button type="button" class="day-task${isToday ? ' ro' : ''}" data-i="${i}" style="--c:${colorOf(c.color)}" aria-pressed="${picked.has(i)}" ${isToday ? 'disabled' : ''}>
            <i class="dt-check${t.done ? ' done' : ''}">${ICON.check}</i>
            <span class="dt-text">${esc(t.text)}</span>
            <span class="dt-meta">${here && !isToday ? 'on today' : esc(c.emoji)}</span></button></li>`;
        })
        .join('')}</ul>
      ${isToday ? '' : `<button class="btn" type="button" data-copy>${copyLabel()}</button>`}`;
  };
  const copyLabel = () => (picked.size ? `Add ${picked.size} to today` : 'Pick tasks to add');
  panel.addEventListener('click', (e) => {
    const row = e.target.closest('.day-task');
    if (row && !row.disabled) {
      const i = Number(row.dataset.i);
      if (picked.has(i)) picked.delete(i);
      else picked.add(i);
      row.setAttribute('aria-pressed', String(picked.has(i)));
      haptic('tap');
      const b = panel.querySelector('[data-copy]');
      if (b) b.textContent = copyLabel();
      return;
    }
    if (e.target.closest('[data-copy]')) {
      const k = sheet.$('.cell.sel')?.dataset.k;
      const list = (k && dayData(k)?.tasks) || [];
      const items = [...picked].sort((a, b) => a - b).map((i) => list[i]).filter(Boolean);
      if (!items.length) return;
      if (copyTasks(items)) sheet.close();
    }
  });

  sheet.$('.hist-grid').addEventListener('click', (e) => {
    const b = e.target.closest('button.cell');
    if (!b) return;
    haptic('tap');
    sheet.$$('.cell.sel').forEach((c) => c.classList.remove('sel'));
    b.classList.add('sel');
    const k = b.dataset.k;
    const h = dayData(k);
    const label = keyToDate(k).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    const text = !h || !h.d ? (h?.tasks?.length ? `${h.tasks.length} on the list` : 'Nothing logged') : h.d >= h.t ? `All ${h.t} done ✓` : `${h.d} of ${h.t} done`;
    sheet.$('.hist-detail').textContent = `${label} · ${text}`;
    showDay(k);
  });
}
