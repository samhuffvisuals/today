// Your days: a calendar of wins. Days you finished are solid, days you made progress
// are tinted, and everything else is just blank. Nothing here counts against you.
import { store } from '../store.js';
import { addDays, keyToDate, stats, daysDone, tasksDone, weekday } from '../rollover.js';
import { openSheet } from './sheets.js';
import { haptic } from '../haptics.js';
import { DAY_ORDER, DAY_SHORT } from './render.js';

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
      return { d: st.done, t: st.total };
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
      <p class="hist-detail">${won ? `${won} ${won === 1 ? 'day' : 'days'} finished in the last five weeks` : 'Tap a day'}</p>`,
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
    const text = !h || !h.d ? 'Nothing logged' : h.d >= h.t ? `All ${h.t} done ✓` : `${h.d} done`;
    sheet.$('.hist-detail').textContent = `${label} · ${text}`;
  });
}
