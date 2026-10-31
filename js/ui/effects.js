// Visual effects: spring easing, particle bursts, confetti, the "Done." overlay.
import { PALETTE, store } from '../store.js';
import { tasksFor, daysDone, keyToDate } from '../rollover.js';
import { esc, ICON } from './icons.js';

export const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const SPRING_LINEAR =
  'linear(0, 0.12 4%, 0.42 10%, 0.75 18%, 0.93 26%, 1.025 34%, 1.04 42%, 1.02 54%, 1.005 70%, 1)';
export const SPRING = CSS.supports('transition-timing-function', SPRING_LINEAR)
  ? SPRING_LINEAR
  : 'cubic-bezier(.2, 1.15, .35, 1)';

export function burst(x, y, color) {
  if (reduceMotion()) return;
  const ring = document.createElement('i');
  ring.className = 'shock';
  ring.style.cssText = `left:${x - 20}px;top:${y - 20}px;border-color:${color}`;
  document.body.appendChild(ring);
  ring.animate(
    [{ transform: 'scale(.6)', opacity: 0.9 }, { transform: 'scale(2.1)', opacity: 0 }],
    { duration: 480, easing: 'cubic-bezier(.2,.8,.3,1)' }
  ).onfinish = () => ring.remove();

  const n = 12;
  for (let i = 0; i < n; i++) {
    const p = document.createElement('i');
    p.className = 'particle';
    const size = 5 + Math.random() * 5;
    p.style.cssText = `left:${x - size / 2}px;top:${y - size / 2}px;width:${size}px;height:${size}px;background:${color}`;
    document.body.appendChild(p);
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
    const d = 28 + Math.random() * 26;
    p.animate(
      [
        { transform: 'translate(0,0) scale(1)', opacity: 1 },
        { transform: `translate(${Math.cos(a) * d}px, ${Math.sin(a) * d}px) scale(.2)`, opacity: 0 },
      ],
      { duration: 520 + Math.random() * 220, easing: 'cubic-bezier(.15,.8,.3,1)' }
    ).onfinish = () => p.remove();
  }
}

let celTimer = 0;
let confettiRaf = 0;

// The full-screen finish: the day color floods the screen, every finished task
// ticks in one after another, then the all-time days-done count.
export function celebrate() {
  const s = store.state;
  const el = document.getElementById('celebrate');
  const done = tasksFor(s, s.day.key).filter((t) => s.day.done[t.id]);
  const d = keyToDate(s.day.key);
  const n = daysDone(s);

  el.querySelector('.cel-sub').textContent = `${done.length} ${done.length === 1 ? 'task' : 'tasks'} · ${d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}`;
  el.querySelector('.cel-list').innerHTML = done
    .slice(0, 7)
    .map((t, i) => `<li style="--i:${i}"><i>${ICON.check}</i><span>${esc(t.text)}</span></li>`)
    .join('') + (done.length > 7 ? `<li style="--i:7"><span class="more">+${done.length - 7} more</span></li>` : '');
  el.querySelector('.cel-stat').innerHTML = `<b>${n}</b> ${n === 1 ? 'day' : 'days'} done`;

  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  el.onclick = dismissCelebrate;
  clearTimeout(celTimer);
  celTimer = setTimeout(dismissCelebrate, 9000);
  if (!reduceMotion()) confetti();
}

export function dismissCelebrate() {
  clearTimeout(celTimer);
  document.getElementById('celebrate').classList.remove('show');
}

function confetti() {
  cancelAnimationFrame(confettiRaf);
  const cv = document.getElementById('confetti');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = innerWidth;
  const H = innerHeight;
  cv.width = W * dpr;
  cv.height = H * dpr;
  cv.style.display = 'block';
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const colors = ['#ffffff', '#000000', '#ffffff', ...PALETTE.map((p) => p.hex)];
  const parts = [];
  for (let i = 0; i < 160; i++) {
    const left = i % 2 === 0;
    const spread = 0.2 + Math.random() * 0.6; // radians away from straight up
    const speed = H * (0.022 + Math.random() * 0.016);
    parts.push({
      x: left ? -10 : W + 10,
      y: H * 0.78,
      vx: Math.sin(spread) * speed * (left ? 1 : -1),
      vy: -Math.cos(spread) * speed,
      w: 6 + Math.random() * 6,
      h: 9 + Math.random() * 8,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.35,
      flip: Math.random() * Math.PI,
      c: colors[i % colors.length],
      round: Math.random() < 0.25,
    });
  }
  const t0 = performance.now();
  let last = t0;
  const frame = (now) => {
    const dt = Math.min(34, now - last) / 16.67;
    last = now;
    const age = now - t0;
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = age > 1900 ? Math.max(0, 1 - (age - 1900) / 600) : 1;
    for (const p of parts) {
      p.vy += 0.38 * dt;
      p.vx *= 0.985;
      p.vy *= 0.985;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.r += p.vr * dt;
      p.flip += 0.12 * dt;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.scale(1, Math.cos(p.flip));
      ctx.fillStyle = p.c;
      if (p.round) {
        ctx.beginPath();
        ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      }
      ctx.restore();
    }
    if (age < 2500) confettiRaf = requestAnimationFrame(frame);
    else {
      ctx.clearRect(0, 0, W, H);
      cv.style.display = 'none';
    }
  };
  confettiRaf = requestAnimationFrame(frame);
}
