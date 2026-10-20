// Entry point: boot, day rollover triggers, and top-level wiring.
import { store } from './store.js';
import { rollover } from './rollover.js';
import { haptic, setHapticsEnabled } from './haptics.js';
import { setSoundEnabled } from './sound.js';
import { toggleTask, deleteTask, reorder, toggleCollapse, carryTasks, dismissCarry } from './actions.js';
import { render } from './ui/render.js';
import { initGestures } from './ui/gestures.js';
import { openQuickAdd, openEdit, openSettings, openCategory } from './ui/sheets.js';
import { openHistory } from './ui/history.js';
import { applyTheme } from './ui/theme.js';
import { ICON } from './ui/icons.js';

const $ = (s) => document.querySelector(s);

function checkDay() {
  if (rollover(store.state).changed) {
    store.save();
    render();
  }
}

function boot() {
  const s = store.state;
  applyTheme(s.settings.theme);
  setHapticsEnabled(s.settings.haptics);
  setSoundEnabled(s.settings.sound);

  $('#gear').innerHTML = ICON.gear;
  $('#fab').innerHTML = ICON.plus;

  rollover(s);
  store.save();
  render();

  const groups = $('#groups');
  const scroller = $('#scroller');

  initGestures(groups, scroller, {
    onToggle: toggleTask,
    onDelete: deleteTask,
    onReorder: reorder,
    onHeaderLong: (catId) => openCategory(catId),
  });

  groups.addEventListener('click', (e) => {
    const check = e.target.closest('.check');
    if (check) return toggleTask(check.closest('.task').dataset.id);
    const body = e.target.closest('.task-body');
    if (body) {
      haptic('tap');
      return openEdit(body.closest('.task').dataset.id);
    }
    const head = e.target.closest('.group-head');
    if (head) toggleCollapse(head.closest('.group').dataset.cat);
  });

  $('#carry').addEventListener('click', (e) => {
    if (e.target.closest('.carry-yes')) carryTasks();
    else if (e.target.closest('.carry-no')) dismissCarry();
  });

  $('#fab').addEventListener('click', () => {
    haptic('tap');
    openQuickAdd();
  });
  $('#gear').addEventListener('click', () => {
    haptic('tap');
    openSettings();
  });
  $('#streak').addEventListener('click', () => {
    haptic('tap');
    openHistory();
  });

  // Rollover: there's no background execution, so check whenever we come back.
  document.addEventListener('visibilitychange', () => !document.hidden && checkDay());
  window.addEventListener('focus', checkDay);
  window.addEventListener('pageshow', checkDay);
  document.addEventListener('daycheck', checkDay);
  setInterval(() => !document.hidden && checkDay(), 30000);

  // Keep bottom sheets above the iOS keyboard.
  const vv = window.visualViewport;
  if (vv) {
    const onVV = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty('--kb', `${Math.round(kb)}px`);
      document.documentElement.classList.toggle('kb-open', kb > 80);
    };
    vv.addEventListener('resize', onVV);
    vv.addEventListener('scroll', onVV);
  }

  // No pinch zoom (iOS ignores user-scalable=no in Safari).
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  navigator.storage?.persist?.().catch(() => {});

  // Service worker. Skipped on localhost so edits show up immediately; add ?sw to test offline locally.
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if ('serviceWorker' in navigator && (!local || location.search.includes('sw'))) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW failed', e));
  }

  // Handy in the console: __today.store.state
  window.__today = { store, rollover, render };
}

boot();
