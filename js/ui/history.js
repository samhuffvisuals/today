// 30-day history grid, colored by completion %.
import { store } from '../store.js';
import { addDays, keyToDate, stats, streak, weekday } from '../rollover.js';
import { openSheet } from './sheets.js';
import { haptic } from '../haptics.js';
import { DAY_ORDER, DAY_SHORT } from './render.js';

export function openHistory() {
  const s = store.state;
  const today = s.day.key;
  const start = addDays(today, -29);
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
  let perfect = 0;
  let sumPct = 0;
  let counted = 0;
  for (let k = gridStart; k <= gridEnd; k = addDays(k, 1)) {
    if (k < start || k > today) {
      cells += `<span class="cell out"></span>`;
      continue;
    }
    const h = dayData(k);
    let cls = 'cell';
    let style = '';
    if (!h) cls += ' none';
    else if (h.t === 0) cls += ' rest';
    else {
      const pct = h.d / h.t;
      counted++;
      sumPct += pct;
      if (pct >= 1) {
        perfect++;
        cls += ' perfect';
      } else if (pct > 0) style = `--m:${Math.round(22 + pct * 58)}%`;
      else cls += ' zero';
    }
    if (k === today) cls += ' today';
    cells += `<button type="button" class="${cls}" style="${style}" data-k="${k}" aria-label="${k}"></button>`;
  }

  const avg = counted ? Math.round((sumPct / counted) * 100) : 0;
  const sheet = openSheet({
    title: 'Last 30 days',
    content: `
      <div class="hist-stats">
        <div class="stat"><b>🔥 ${streak(s)}</b><span>Current streak</span></div>
        <div class="stat"><b>${s.bestStreak || 0}</b><span>Best streak</span></div>
        <div class="stat"><b>${perfect}</b><span>Perfect days</span></div>
        <div class="stat"><b>${avg}%</b><span>Average</span></div>
      </div>
      <div class="hist-grid">
        ${DAY_ORDER.map((d) => `<span class="hist-dow">${DAY_SHORT[d]}</span>`).join('')}
        ${cells}
      </div>
      <p class="hist-detail">Tap a day for details</p>
      <div class="legend"><span>Less</span><i class="cell zero"></i><i class="cell" style="--m:30%"></i><i class="cell" style="--m:60%"></i><i class="cell perfect"></i><span>100%</span></div>`,
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
    const text = !h ? 'Not tracked' : h.t === 0 ? 'Nothing scheduled' : `${h.d} of ${h.t} done${h.d >= h.t ? ' ✓' : ''}`;
    sheet.$('.hist-detail').textContent = `${label} · ${text}`;
  });
}
