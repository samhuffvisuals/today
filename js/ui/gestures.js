// Touch gestures on the task list:
//  - swipe right to complete, left to delete (rubber-band + snap point)
//  - long-press a task to lift it, drag to reorder within its group
//  - long-press a category header to edit it
// Touch events are used directly (not pointer events) because iOS needs a
// non-passive touchmove to stop scrolling once a swipe or drag starts.
import { haptic } from '../haptics.js';

const SLOP = 8;
const LIFT_MS = 380;
const HEAD_MS = 480;
const SNAP = 84; // px of visible travel that arms the action
const FREE = 100; // px of 1:1 travel before resistance kicks in

let g = null;
let suppressUntil = 0;
export const gestureBusy = () => !!g && (g.mode === 'drag' || g.mode === 'swipe');

const suppressClick = () => (suppressUntil = performance.now() + 450);

function rubber(x, w) {
  const a = Math.abs(x);
  if (a <= FREE) return x;
  const d = w * 0.45;
  const extra = (1 - 1 / (((a - FREE) * 0.55) / d + 1)) * d;
  return Math.sign(x) * (FREE + extra);
}

export function initGestures(root, scroller, cb) {
  // Swallow the click that follows a swipe/drag/long-press.
  root.addEventListener(
    'click',
    (e) => {
      if (performance.now() < suppressUntil) {
        e.stopPropagation();
        e.preventDefault();
      }
    },
    true
  );

  const lock = (on) => scroller.classList.toggle('locked', on);

  function start(x, y, target) {
    if (g) cancel();
    const head = target.closest('.group-head');
    if (head) {
      head.classList.add('pressing');
      g = { kind: 'head', el: head, x0: x, y0: y };
      g.timer = setTimeout(() => {
        head.classList.remove('pressing');
        suppressClick();
        haptic('lift');
        g = null;
        cb.onHeaderLong(head.closest('.group').dataset.cat);
      }, HEAD_MS);
      return;
    }
    const li = target.closest('.task');
    if (!li) return;
    g = { kind: 'task', li, fg: li.querySelector('.task-fg'), x0: x, y0: y, x, y, mode: 'pending', armed: 0, w: li.offsetWidth };
    g.timer = setTimeout(() => g && g.mode === 'pending' && lift(), LIFT_MS);
  }

  function move(x, y, e) {
    if (!g) return;
    const dx = x - g.x0;
    const dy = y - g.y0;
    if (g.kind === 'head') {
      if (Math.hypot(dx, dy) > SLOP) {
        clearTimeout(g.timer);
        g.el.classList.remove('pressing');
        g = null;
      }
      return;
    }
    g.x = x;
    g.y = y;
    if (g.mode === 'pending') {
      if (Math.abs(dx) > SLOP && Math.abs(dx) > Math.abs(dy) * 1.2) {
        clearTimeout(g.timer);
        g.mode = 'swipe';
        g.off = Math.sign(dx) * SLOP;
        g.fg.classList.remove('springback', 'flyout');
        g.li.classList.add('swiping');
        lock(true);
      } else if (Math.hypot(dx, dy) > SLOP) {
        clearTimeout(g.timer);
        g.mode = 'scroll';
        return;
      } else return;
    }
    if (g.mode === 'swipe') {
      if (e.cancelable) e.preventDefault();
      swipeMove(dx - g.off);
    } else if (g.mode === 'drag') {
      if (e.cancelable) e.preventDefault();
      dragMove();
    }
  }

  function end() {
    if (!g) return;
    clearTimeout(g.timer);
    if (g.kind === 'head') {
      g.el.classList.remove('pressing');
      g = null;
      return;
    }
    if (g.mode === 'swipe') swipeEnd();
    else if (g.mode === 'drag') dragEnd();
    else g = null;
  }

  function cancel() {
    if (!g) return;
    clearTimeout(g.timer);
    if (g.kind === 'head') g.el.classList.remove('pressing');
    else if (g.mode === 'swipe') {
      g.armed = 0;
      swipeEnd();
      return;
    } else if (g.mode === 'drag') {
      dragEnd();
      return;
    }
    g = null;
  }

  /* ---------- swipe ---------- */

  function swipeMove(raw) {
    const v = rubber(raw, g.w);
    g.fg.style.transform = `translate3d(${v}px,0,0)`;
    g.li.dataset.dir = v >= 0 ? 'right' : 'left';
    g.li.style.setProperty('--p', Math.min(1, Math.abs(v) / SNAP).toFixed(3));
    const armed = v >= SNAP ? 1 : v <= -SNAP ? -1 : 0;
    if (armed !== g.armed) {
      g.armed = armed;
      if (armed) {
        g.li.dataset.armed = '';
        haptic('snap'); // usually silent on iOS (touchmove isn't a user gesture)
      } else delete g.li.dataset.armed;
    }
  }

  function swipeEnd() {
    const { li, fg, armed } = g;
    g = null;
    lock(false);
    suppressClick();
    const reset = () => {
      li.classList.remove('swiping');
      delete li.dataset.dir;
      delete li.dataset.armed;
      li.style.removeProperty('--p');
    };
    if (armed < 0) {
      haptic('tap');
      fg.classList.add('flyout');
      fg.style.transform = `translate3d(${-li.offsetWidth - 24}px,0,0)`;
      li.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 240, delay: 80, fill: 'forwards' });
      setTimeout(() => cb.onDelete(li.dataset.id), 230);
      return;
    }
    fg.classList.add('springback');
    fg.style.transform = '';
    if (armed > 0) cb.onToggle(li.dataset.id); // synchronous: haptic fires inside touchend
    setTimeout(() => {
      fg.classList.remove('springback');
      reset();
    }, 480);
  }

  /* ---------- drag to reorder ---------- */

  function lift() {
    const li = g.li;
    const ul = li.parentElement;
    const items = [...ul.children];
    const rects = items.map((el) => el.getBoundingClientRect());
    const idx = items.indexOf(li);
    const gap = items.length > 1 ? rects[1].top - rects[0].bottom : 10;
    Object.assign(g, {
      mode: 'drag',
      items,
      idx,
      target: idx,
      st0: scroller.scrollTop,
      tops: rects.map((r) => r.top),
      hs: rects.map((r) => r.height),
      step: rects[idx].height + gap,
    });
    lock(true);
    li.classList.add('lifted');
    ul.classList.add('reordering');
    li.style.transition = 'transform .2s cubic-bezier(.2,1.2,.4,1)';
    li.style.transform = 'translate3d(0,0,0) scale(1.035)';
    setTimeout(() => {
      if (g && g.li === li) li.style.transition = 'none';
    }, 200);
    haptic('lift'); // usually silent on iOS (fires from a timer)
    const loop = () => {
      if (!g || g.mode !== 'drag') return;
      const zone = 110;
      let v = 0;
      if (g.y < zone) v = -Math.ceil((zone - g.y) / 7);
      else if (g.y > innerHeight - zone) v = Math.ceil((g.y - (innerHeight - zone)) / 7);
      if (v) {
        scroller.scrollTop += v;
        dragMove();
      }
      g.raf = requestAnimationFrame(loop);
    };
    g.raf = requestAnimationFrame(loop);
  }

  function dragMove() {
    const scrolled = scroller.scrollTop - g.st0;
    const n = g.items.length;
    // Keep the card within its group.
    const minDy = g.tops[0] - g.tops[g.idx] - 12;
    const maxDy = g.tops[n - 1] + g.hs[n - 1] - (g.tops[g.idx] + g.hs[g.idx]) + 12;
    const dy = Math.max(minDy, Math.min(maxDy, g.y - g.y0 + scrolled));
    g.li.style.transform = `translate3d(0,${dy}px,0) scale(1.035)`;

    const center = g.tops[g.idx] + g.hs[g.idx] / 2 + dy;
    let t = g.idx;
    for (let i = 0; i < n; i++) {
      if (i === g.idx) continue;
      const mid = g.tops[i] + g.hs[i] / 2;
      if (i < g.idx && center < mid) t = Math.min(t, i);
      if (i > g.idx && center > mid) t = Math.max(t, i);
    }
    if (t === g.target) return;
    g.target = t;
    g.items.forEach((el, i) => {
      if (i === g.idx) return;
      let shift = 0;
      if (g.idx < t && i > g.idx && i <= t) shift = -g.step;
      if (g.idx > t && i < g.idx && i >= t) shift = g.step;
      el.style.transform = shift ? `translate3d(0,${shift}px,0)` : '';
    });
  }

  function dragEnd() {
    const { li, items, idx, target, raf } = g;
    g = null;
    cancelAnimationFrame(raf);
    lock(false);
    suppressClick();
    li.classList.remove('lifted');
    li.parentElement?.classList.remove('reordering');
    haptic('drop'); // fires: we're inside touchend
    const ids = items.map((el) => el.dataset.id);
    const [moved] = ids.splice(idx, 1);
    ids.splice(target, 0, moved);
    cb.onReorder(ids);
  }

  /* ---------- wiring ---------- */

  root.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length !== 1) return cancel();
      const t = e.touches[0];
      start(t.clientX, t.clientY, e.target);
    },
    { passive: true }
  );
  root.addEventListener(
    'touchmove',
    (e) => {
      if (!g) return;
      const t = e.touches[0];
      move(t.clientX, t.clientY, e);
    },
    { passive: false }
  );
  root.addEventListener('touchend', end);
  root.addEventListener('touchcancel', cancel);

  // Mouse support for desktop testing.
  root.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    start(e.clientX, e.clientY, e.target);
    const mv = (ev) => move(ev.clientX, ev.clientY, ev);
    const up = () => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      end();
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  });
}
