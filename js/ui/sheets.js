// Bottom sheets: quick add, edit task, category editor, settings.
import { store, PALETTE, MAX_CATEGORIES, MAX_PACKS, suggest, exportData, importData, eraseAll } from '../store.js';
import { haptic, setHapticsEnabled, overlayHaptics, stats as hapticStats } from '../haptics.js';
import { addTask, editTask, deleteTask, saveCategory, deleteCategory, savePack, deletePack, moveGroupTasks } from '../actions.js';
import { colorOf, catOf, DAY_ORDER, DAY_SHORT, DAY_NAME } from './render.js';
import { tasksFor } from '../rollover.js';
import { openHistory } from './history.js';
import { toast } from './toast.js';
import { ICON, esc } from './icons.js';

const stack = [];

/* ---------- generic sheet ---------- */

export function openSheet({ title = '', className = '', content = '', onClose } = {}) {
  const wrap = document.createElement('div');
  wrap.className = `sheet-wrap ${className}`;
  wrap.innerHTML = `<div class="sheet-backdrop"></div>
    <div class="sheet" role="dialog" aria-modal="true" ${title ? `aria-label="${esc(title)}"` : ''}>
      <div class="grab-zone"><div class="grabber"></div>${title ? `<h2>${esc(title)}</h2>` : ''}</div>
      <div class="sheet-content">${content}</div>
    </div>`;
  document.getElementById('sheet-root').appendChild(wrap);
  const panel = wrap.querySelector('.sheet');
  const body = wrap.querySelector('.sheet-content');
  panel.getBoundingClientRect();
  wrap.classList.add('open');

  let closed = false;
  const api = {
    wrap,
    panel,
    body,
    $: (s) => body.querySelector(s),
    $$: (s) => [...body.querySelectorAll(s)],
    close() {
      if (closed) return;
      closed = true;
      if (wrap.contains(document.activeElement)) document.activeElement.blur();
      wrap.classList.remove('open');
      wrap.classList.add('closing');
      setTimeout(() => wrap.remove(), 340);
      stack.splice(stack.indexOf(api), 1);
      onClose?.();
    },
  };
  // Ignore the tap that opened the sheet (e.g. finger lifting after a long-press).
  const openedAt = performance.now();
  wrap.querySelector('.sheet-backdrop').addEventListener('click', () => {
    if (performance.now() - openedAt > 400) api.close();
  });
  dragToDismiss(wrap.querySelector('.grab-zone'), panel, api.close);
  stack.push(api);
  return api;
}

export const closeTopSheet = () => stack.at(-1)?.close();
export const sheetOpen = () => stack.length > 0;

function dragToDismiss(handle, panel, close) {
  let y0 = null;
  let dy = 0;
  handle.addEventListener('touchstart', (e) => {
    y0 = e.touches[0].clientY;
    dy = 0;
    panel.style.transition = 'none';
  }, { passive: true });
  handle.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    const raw = e.touches[0].clientY - y0;
    dy = raw > 0 ? raw : -Math.sqrt(-raw) * 2; // a little resistance upward
    if (e.cancelable) e.preventDefault();
    panel.style.transform = `translateY(${dy}px)`;
  }, { passive: false });
  const end = () => {
    if (y0 == null) return;
    y0 = null;
    panel.style.transition = '';
    panel.style.transform = '';
    if (dy > 90) close();
  };
  handle.addEventListener('touchend', end);
  handle.addEventListener('touchcancel', end);
}

/* ---------- shared task controls (type, weekdays, category) ---------- */

function taskControls(init) {
  let sheet = null;
  const st = { catId: init.catId, type: init.type, days: init.days ? [...init.days] : null };
  const html = `
    <div class="seg" data-role="type">
      <button type="button" data-v="today">Today only</button>
      <button type="button" data-v="daily">${ICON.repeat}<span>Daily</span></button>
    </div>
    <div class="days-pick" data-role="days">
      ${DAY_ORDER.map((d) => `<button type="button" data-d="${d}" aria-label="${DAY_NAME[d]}">${DAY_SHORT[d]}</button>`).join('')}
    </div>
    <div class="chips" data-role="chips"></div>`;

  function paint() {
    sheet.$$('[data-role=type] button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === st.type)));
    const days = sheet.$('[data-role=days]');
    days.classList.toggle('show', st.type === 'daily');
    days.querySelectorAll('button').forEach((b) =>
      b.setAttribute('aria-pressed', String(!st.days || st.days.includes(Number(b.dataset.d))))
    );
    paintChips();
  }

  function paintChips() {
    const cats = store.state.categories;
    const chips = sheet.$('[data-role=chips]');
    chips.innerHTML =
      cats
        .map(
          (c) => `<button type="button" class="chip" data-cat="${c.id}" style="--c:${colorOf(c.color)}" aria-pressed="${c.id === st.catId}">
            <span>${esc(c.emoji)}</span>${esc(c.name)}</button>`
        )
        .join('') +
      (cats.length < MAX_CATEGORIES ? `<button type="button" class="chip chip-new" data-new>${ICON.plus}<span>New</span></button>` : '');
  }

  function mount(target, { onNewCategory } = {}) {
    sheet = target;
    sheet.$('[data-role=type]').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || b.dataset.v === st.type) return;
      st.type = b.dataset.v;
      haptic('tap');
      paint();
      onNewCategory?.refocus?.();
    });
    sheet.$('[data-role=days]').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const d = Number(b.dataset.d);
      let days = st.days ? [...st.days] : [...DAY_ORDER];
      days = days.includes(d) ? days.filter((x) => x !== d) : [...days, d];
      if (!days.length) {
        haptic('snap');
        return; // keep at least one day
      }
      st.days = days.length === 7 ? null : days;
      haptic('tap');
      paint();
    });
    sheet.$('[data-role=chips]').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.hasAttribute('data-new')) {
        openCategory(null, {
          onSave(c) {
            st.catId = c.id;
            paintChips();
            onNewCategory?.refocus?.();
          },
        });
        return;
      }
      st.catId = b.dataset.cat;
      haptic('tap');
      paintChips();
      onNewCategory?.refocus?.();
    });
    paint();
  }

  return { html, st, mount };
}

/* ---------- quick add ---------- */

// preset: { catId, type } opens the sheet pointed at one group (the "Add to …" row in the list).
export function openQuickAdd(preset = {}) {
  const s = store.state;
  const want = preset.catId || s.settings.lastCat;
  const catId = s.categories.some((c) => c.id === want) ? want : 'general';
  const type = preset.type || (s.settings.lastType === 'daily' ? 'daily' : 'today');
  const ctl = taskControls({ catId, type, days: null });
  let added = 0;

  const sheet = openSheet({
    className: 'add-sheet',
    content: `
      <form class="add-form" autocomplete="off">
        <input class="field add-input" type="text" placeholder="What needs doing?" maxlength="140"
               enterkeyhint="done" autocapitalize="sentences" autocomplete="off" aria-label="New task">
        <button class="add-go" type="button" aria-label="Add task">${ICON.up}</button>
      </form>
      <div class="suggest" data-role="suggest" aria-label="Suggestions"></div>
      ${ctl.html}
      <p class="add-note" aria-live="polite">Return adds and keeps this open.</p>`,
  });
  const input = sheet.$('.add-input');
  // Must be synchronous inside the tap so iOS raises the keyboard.
  // preventScroll stops the browser from scrolling the still-offscreen sheet into view.
  input.focus({ preventScroll: true });

  ctl.mount(sheet, { onNewCategory: { refocus: () => input.focus({ preventScroll: true }) } });
  // Tapping chips/toggles shouldn't steal focus and drop the keyboard.
  sheet.body.addEventListener('mousedown', (e) => {
    if (e.target.closest('button') && !e.target.closest('[data-new]')) e.preventDefault();
  });

  const submit = () => {
    const text = input.value.trim();
    if (!text) {
      if (added) sheet.close(); // Return on an empty field closes after a run of adds
      return;
    }
    addTask(text, ctl.st);
    added++;
    input.value = '';
    input.focus();
    const note = sheet.$('.add-note');
    note.textContent = `Added ${added} ${added === 1 ? 'task' : 'tasks'} ✓`;
    note.classList.remove('bump');
    void note.offsetWidth;
    note.classList.add('bump');
  };
  sheet.$('.add-form').addEventListener('submit', (e) => {
    e.preventDefault();
    submit();
  });
  sheet.$('.add-go').addEventListener('click', submit);

  // Suggestions: most-used tasks when the field is empty, best matches while typing.
  // A tap adds the task straight away, to the group it was last used in (or the
  // preset group when the sheet was opened from an "Add to …" row).
  const box = sheet.$('[data-role=suggest]');
  const paintSuggest = () => {
    const onList = new Set(tasksFor(s, s.day.key).map((t) => t.text.trim().toLowerCase().replace(/\s+/g, ' ')));
    const list = suggest(s, input.value, onList);
    box.innerHTML = list
      .map((r) => {
        const c = catOf(preset.catId || r.catId);
        return `<button type="button" class="sug" data-text="${esc(r.text)}" data-cat="${c.id}" style="--c:${colorOf(c.color)}"><i></i>${esc(r.text)}</button>`;
      })
      .join('');
    box.hidden = !list.length;
  };
  paintSuggest();
  input.addEventListener('input', paintSuggest);
  box.addEventListener('click', (e) => {
    const b = e.target.closest('.sug');
    if (!b) return;
    addTask(b.dataset.text, { ...ctl.st, catId: b.dataset.cat });
    added++;
    input.value = '';
    input.focus({ preventScroll: true });
    const note = sheet.$('.add-note');
    note.textContent = `Added ${added} ${added === 1 ? 'task' : 'tasks'} ✓`;
    note.classList.remove('bump');
    void note.offsetWidth;
    note.classList.add('bump');
    paintSuggest();
  });
}

/* ---------- edit task ---------- */

export function openEdit(id) {
  const t = store.state.tasks.find((x) => x.id === id);
  if (!t) return;
  const ctl = taskControls({ catId: t.catId, type: t.type, days: t.days });
  const sheet = openSheet({
    title: 'Edit task',
    content: `
      <form class="edit-form" autocomplete="off">
        <input class="field" type="text" value="${esc(t.text)}" maxlength="140" enterkeyhint="done" aria-label="Task">
      </form>
      <div data-ctl></div>
      <button class="btn" type="button" data-save>Save</button>
      <button class="btn danger" type="button" data-del>Delete task</button>`,
  });
  sheet.$('[data-ctl]').outerHTML = ctl.html;
  ctl.mount(sheet);

  const input = sheet.$('.field');
  const save = () => {
    const text = input.value.trim();
    if (!text) return input.focus();
    haptic('tap');
    editTask(id, { text, ...ctl.st });
    sheet.close();
  };
  sheet.$('.edit-form').addEventListener('submit', (e) => {
    e.preventDefault();
    save();
  });
  sheet.$('[data-save]').addEventListener('click', save);
  sheet.$('[data-del]').addEventListener('click', () => {
    haptic('tap');
    sheet.close();
    deleteTask(id);
  });
}

/* ---------- category editor ---------- */

const EMOJI = ['✅', '🎬', '🏠', '🧹', '✈️', '🐶', '💪', '📦', '💼', '🎨', '🛒', '💰', '🍎', '💊', '🌱', '🎮', '❤️', '⭐', '🔥', '🎯', '💡', '🎵', '☕', '📚'];

const firstGrapheme = (str) => {
  if (!str) return '';
  if (window.Intl?.Segmenter) {
    const it = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(str)[Symbol.iterator]().next();
    return it.done ? '' : it.value.segment;
  }
  return Array.from(str)[0];
};

// Two-tap confirm for destructive buttons, no native dialogs.
function confirmTap(btn, label, onConfirm) {
  let armed = false;
  let timer = 0;
  const original = btn.textContent;
  btn.addEventListener('click', () => {
    if (armed) {
      clearTimeout(timer);
      onConfirm();
      return;
    }
    armed = true;
    haptic('snap');
    btn.textContent = label;
    btn.classList.add('armed');
    timer = setTimeout(() => {
      armed = false;
      btn.textContent = original;
      btn.classList.remove('armed');
    }, 3000);
  });
}

export function openCategory(id, { onSave } = {}) {
  const s = store.state;
  const c = id ? s.categories.find((x) => x.id === id) : null;
  if (!c && s.categories.length >= MAX_CATEGORIES) {
    toast(`You can have up to ${MAX_CATEGORIES} categories`);
    return;
  }
  const used = new Set(s.categories.map((x) => x.color));
  const todayCount = c ? tasksFor(s, s.day.key).filter((t) => t.catId === c.id).length : 0;
  let emoji = c?.emoji || '⭐';
  let color = c?.color || (PALETTE.find((p) => !used.has(p.id)) || PALETTE[0]).id;

  const sheet = openSheet({
    title: c ? 'Edit category' : 'New category',
    content: `
      <div class="cat-row">
        <input class="field emoji-field" type="text" value="${esc(emoji)}" aria-label="Emoji" autocomplete="off">
        <input class="field name-field" type="text" value="${esc(c?.name || '')}" placeholder="Name" maxlength="24" enterkeyhint="done" aria-label="Category name" autocapitalize="words">
      </div>
      <div class="emoji-pick">${EMOJI.map((e) => `<button type="button" data-e="${e}">${e}</button>`).join('')}</div>
      <div class="palette">${PALETTE.map((p) => `<button type="button" class="swatch" data-color="${p.id}" style="--c:${p.hex}" aria-label="${p.id}"></button>`).join('')}</div>
      <button class="btn" type="button" data-save>${c ? 'Save' : 'Create category'}</button>
      ${c && todayCount ? `
      <h3>Move today's tasks</h3>
      <p class="hint">Send all ${todayCount} ${todayCount === 1 ? 'task' : 'tasks'} in ${esc(c.name)} to another group.</p>
      <div class="chips" data-role="move">${s.categories
        .filter((x) => x.id !== c.id)
        .map((x) => `<button type="button" class="chip" data-move="${x.id}" style="--c:${colorOf(x.color)}"><span>${esc(x.emoji)}</span>${esc(x.name)}</button>`)
        .join('')}${s.categories.length < MAX_CATEGORIES ? `<button type="button" class="chip chip-new" data-move-new>${ICON.plus}<span>New group</span></button>` : ''}</div>` : ''}
      ${c && c.id !== 'general' ? `<button class="btn danger" type="button" data-del>Delete category</button><p class="hint">Its tasks move to ${esc(s.categories[0].name)}.</p>` : ''}`,
  });

  const emojiInput = sheet.$('.emoji-field');
  const nameInput = sheet.$('.name-field');
  const paint = () => {
    sheet.$$('.emoji-pick button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.e === emoji)));
    sheet.$$('.swatch').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.color === color)));
    sheet.panel.style.setProperty('--c', colorOf(color));
  };
  paint();
  if (!c) nameInput.focus({ preventScroll: true });

  emojiInput.addEventListener('input', () => {
    const g = firstGrapheme(emojiInput.value.trim());
    if (g) {
      emoji = g;
      emojiInput.value = g;
      paint();
    }
  });
  emojiInput.addEventListener('focus', () => emojiInput.select());
  sheet.$('.emoji-pick').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    emoji = b.dataset.e;
    emojiInput.value = emoji;
    haptic('tap');
    paint();
  });
  sheet.$('.palette').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    color = b.dataset.color;
    haptic('tap');
    paint();
  });

  const save = () => {
    const name = nameInput.value.trim() || 'Untitled';
    const saved = saveCategory({ id: c?.id, name, emoji, color });
    sheet.close();
    if (saved) onSave?.(saved);
  };
  sheet.$('[data-save]').addEventListener('click', save);
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      save();
    }
  });
  const del = sheet.$('[data-del]');
  if (del) confirmTap(del, 'Tap again to delete', () => {
    deleteCategory(c.id);
    sheet.close();
    onSave?.(null);
  });

  sheet.$('[data-role=move]')?.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.hasAttribute('data-move-new')) {
      // Make the group first, then move everything into it.
      openCategory(null, {
        onSave(created) {
          if (!created) return;
          moveGroupTasks(c.id, created.id);
          sheet.close();
          onSave?.(created);
        },
      });
      return;
    }
    moveGroupTasks(c.id, b.dataset.move);
    sheet.close();
    onSave?.(c);
  });
}

/* ---------- pack editor ---------- */

export function openPack(id, { onSave } = {}) {
  const s = store.state;
  const p = id ? s.packs.find((x) => x.id === id) : null;
  if (!p && s.packs.length >= MAX_PACKS) {
    toast(`You can have up to ${MAX_PACKS} packs`);
    return;
  }
  let emoji = p?.emoji || '📦';
  let catId = p && s.categories.some((c) => c.id === p.catId) ? p.catId : 'general';

  const sheet = openSheet({
    title: p ? 'Edit pack' : 'New pack',
    className: 'pack-sheet',
    content: `
      <div class="cat-row">
        <input class="field emoji-field" type="text" value="${esc(emoji)}" aria-label="Emoji" autocomplete="off">
        <input class="field name-field" type="text" value="${esc(p?.name || '')}" placeholder="Pack name" maxlength="24" enterkeyhint="next" aria-label="Pack name" autocapitalize="words">
      </div>
      <h3>Goes into</h3>
      <div class="chips" data-role="chips"></div>
      <h3>Tasks, one per line</h3>
      <textarea class="field items-field" rows="6" placeholder="Download footage&#10;Sort footage&#10;Find song" aria-label="Tasks">${esc((p?.items || []).join('\n'))}</textarea>
      <h3>Icon</h3>
      <div class="emoji-pick">${EMOJI.map((e) => `<button type="button" data-e="${e}">${e}</button>`).join('')}</div>
      <button class="btn" type="button" data-save>${p ? 'Save' : 'Create pack'}</button>
      ${p ? `<button class="btn danger" type="button" data-del>Delete pack</button>` : ''}`,
  });

  const emojiInput = sheet.$('.emoji-field');
  const nameInput = sheet.$('.name-field');
  const itemsInput = sheet.$('.items-field');
  const paint = () => {
    sheet.$$('.emoji-pick button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.e === emoji)));
    sheet.$('[data-role=chips]').innerHTML = s.categories
      .map(
        (c) => `<button type="button" class="chip" data-cat="${c.id}" style="--c:${colorOf(c.color)}" aria-pressed="${c.id === catId}">
          <span>${esc(c.emoji)}</span>${esc(c.name)}</button>`
      )
      .join('');
    sheet.panel.style.setProperty('--c', colorOf((s.categories.find((c) => c.id === catId) || s.categories[0]).color));
  };
  paint();
  if (!p) nameInput.focus({ preventScroll: true });

  emojiInput.addEventListener('input', () => {
    const g = firstGrapheme(emojiInput.value.trim());
    if (g) {
      emoji = g;
      emojiInput.value = g;
      paint();
    }
  });
  emojiInput.addEventListener('focus', () => emojiInput.select());
  sheet.$('.emoji-pick').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    emoji = b.dataset.e;
    emojiInput.value = emoji;
    haptic('tap');
    paint();
  });
  sheet.$('[data-role=chips]').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    catId = b.dataset.cat;
    haptic('tap');
    paint();
  });
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      itemsInput.focus();
    }
  });

  sheet.$('[data-save]').addEventListener('click', () => {
    const name = nameInput.value.trim() || 'Untitled';
    const items = itemsInput.value.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 30);
    if (!items.length) {
      haptic('snap');
      itemsInput.focus();
      return;
    }
    const saved = savePack({ id: p?.id, name, emoji, catId, items });
    sheet.close();
    if (saved) onSave?.(saved);
  });
  const del = sheet.$('[data-del]');
  if (del) confirmTap(del, 'Tap again to delete', () => {
    deletePack(p.id);
    sheet.close();
    onSave?.(null);
  });
}

/* ---------- settings ---------- */

export const APP_VERSION = 'v3.12';

const toMinutes = (v) => {
  const [h, m] = v.split(':').map(Number);
  return h * 60 + (m || 0);
};
const toTime = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

export function openSettings() {
  const s = store.state;
  const sheet = openSheet({
    title: 'Settings',
    className: 'settings-sheet',
    content: `
      <h3>Day</h3>
      <div class="set-group">
        <label class="set-row"><span class="label">New day starts at</span>
          <input type="time" data-role="daystart" value="${toTime(s.settings.dayStart)}" step="900">
        </label>
      </div>
      <p class="hint">Tasks reset at this time, so late nights still count as the same day.</p>

      <h3>Feel</h3>
      <div class="set-group">
        <button class="set-row" type="button" data-toggle="haptics"><span class="label">Haptics</span><span class="toggle" role="switch"></span></button>
      </div>
      <div class="set-group">
        <button class="set-row" type="button" data-act="htest"><span class="label">Tap here to test</span><span class="htest-n" aria-live="polite"></span></button>
      </div>
      <p class="hint" data-role="hdiag"></p>

      <h3>Packs</h3>
      <div class="set-group" data-role="packs"></div>
      <p class="hint">A pack drops a whole set of tasks onto today in one tap. On the main screen, tap a pack to add it and long-press it to edit it.</p>

      <h3>Categories</h3>
      <div class="set-group" data-role="cats"></div>
      <p class="hint">Tip: press and hold a group's header in the list to edit it or move all of its tasks to another group.</p>

      <h3>History</h3>
      <div class="set-group">
        <button class="set-row" type="button" data-act="history"><span class="label">Your days</span>${ICON.right}</button>
      </div>

      <h3>Backup</h3>
      <div class="set-group">
        <button class="set-row" type="button" data-act="export"><span class="label">Export backup (JSON)</span>${ICON.right}</button>
        <button class="set-row" type="button" data-act="import"><span class="label">Import backup…</span>${ICON.right}</button>
      </div>
      <input type="file" accept="application/json,.json" data-role="file" hidden>

      <h3>App</h3>
      <div class="set-group">
        <button class="set-row" type="button" data-act="refresh"><span class="label">Get the latest version<small data-role="swv">Reinstalls the app files. Your tasks stay.</small></span>${ICON.right}</button>
      </div>
      <button class="btn danger" type="button" data-act="erase">Erase all data</button>
      <p class="hint center">Today · ${APP_VERSION} · Everything stays on this device.</p>`,
  });

  const paintToggles = () =>
    sheet.$$('[data-toggle]').forEach((b) => b.querySelector('.toggle').setAttribute('aria-checked', String(!!s.settings[b.dataset.toggle])));
  const paintCats = () => {
    const box = sheet.$('[data-role=cats]');
    box.innerHTML =
      s.categories
        .map(
          (c) => `<button class="set-row" type="button" data-cat="${c.id}">
            <span class="dot" style="--c:${colorOf(c.color)}"></span><span class="cat-emoji">${esc(c.emoji)}</span>
            <span class="label">${esc(c.name)}</span>${ICON.right}</button>`
        )
        .join('') +
      (s.categories.length < MAX_CATEGORIES
        ? `<button class="set-row add-row" type="button" data-cat-new>${ICON.plus}<span class="label">New category</span></button>`
        : `<div class="set-row muted"><span class="label">Maximum of ${MAX_CATEGORIES} categories</span></div>`);
  };
  const paintPacks = () => {
    const box = sheet.$('[data-role=packs]');
    box.innerHTML =
      s.packs
        .map(
          (p) => `<button class="set-row" type="button" data-pack="${p.id}">
            <span class="cat-emoji">${esc(p.emoji)}</span>
            <span class="label">${esc(p.name)}<small>${p.items.length} ${p.items.length === 1 ? 'task' : 'tasks'}</small></span>${ICON.right}</button>`
        )
        .join('') +
      (s.packs.length < MAX_PACKS
        ? `<button class="set-row add-row" type="button" data-pack-new>${ICON.plus}<span class="label">New pack</span></button>`
        : `<div class="set-row muted"><span class="label">Maximum of ${MAX_PACKS} packs</span></div>`);
  };
  paintToggles();
  paintCats();
  paintPacks();

  sheet.$('[data-role=packs]').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    openPack(b.hasAttribute('data-pack-new') ? null : b.dataset.pack, { onSave: paintPacks });
  });

  sheet.$('[data-role=daystart]').addEventListener('change', (e) => {
    if (!e.target.value) return;
    s.settings.dayStart = toMinutes(e.target.value);
    store.save();
    document.dispatchEvent(new Event('daycheck'));
  });

  sheet.$$('[data-toggle]').forEach((b) =>
    b.addEventListener('click', () => {
      const k = b.dataset.toggle;
      s.settings[k] = !s.settings[k];
      store.save();
      if (k === 'haptics') setHapticsEnabled(s.settings.haptics);
      haptic('tap');
      paintToggles();
    })
  );

  let taps = 0;
  const paintDiag = () => {
    const m = navigator.userAgent.match(/OS (\d+)[._](\d+)/);
    const ios = m ? `iOS ${m[1]}.${m[2]}` : 'not iOS';
    const mode = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone ? 'home screen app' : 'Safari tab';
    sheet.$('[data-role=hdiag]').innerHTML = overlayHaptics
      ? `Every real tap plays the iPhone's switch haptic. Silent? Check iPhone Settings → Sounds &amp; Haptics → <b>System Haptics</b>.<br>
         <span class="diag">${ios} · ${mode} · overlays ${document.querySelectorAll('label.hap').length} · taps ${hapticStats.taps} · forwarded ${hapticStats.forwarded}</span>`
      : `Haptic overlays are off on this device (${ios}). Android uses vibration patterns where supported.`;
  };
  paintDiag();
  sheet.$('[data-act=htest]').addEventListener('click', () => {
    haptic('tap');
    sheet.$('.htest-n').textContent = `${++taps} ${taps === 1 ? 'tap' : 'taps'}`;
    setTimeout(paintDiag, 50);
  });

  sheet.$('[data-role=cats]').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    openCategory(b.hasAttribute('data-cat-new') ? null : b.dataset.cat, { onSave: paintCats });
  });

  const fileInput = sheet.$('[data-role=file]');
  sheet.body.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'history') openHistory();
    if (act === 'export') doExport();
    if (act === 'import') fileInput.click();
    if (act === 'refresh') hardRefresh();
  });

  // Show which service worker version is actually serving the page.
  navigator.serviceWorker?.addEventListener('message', (e) => {
    const el = sheet.$('[data-role=swv]');
    if (e.data?.version && el) el.textContent = `Files: ${e.data.version}. Tap to reinstall; your tasks stay.`;
  }, { once: true });
  navigator.serviceWorker?.controller?.postMessage('version');

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      JSON.parse(text);
      if (!confirm('Replace everything in the app with this backup?')) return;
      importData(text);
      location.reload();
    } catch (err) {
      toast('That file isn’t a valid Today backup');
    }
  });

  confirmTap(sheet.$('[data-act=erase]'), 'Tap again to erase everything', () => {
    eraseAll();
    location.reload();
  });
}

// Drop every cached file and the service worker, then reload from the network.
async function hardRefresh() {
  toast('Refreshing…');
  try {
    const regs = await navigator.serviceWorker?.getRegistrations?.();
    await Promise.all((regs || []).map((r) => r.unregister()));
    const keys = await caches?.keys?.();
    await Promise.all((keys || []).map((k) => caches.delete(k)));
    // Re-fetch every file this page loaded straight from the network, so the browser's
    // own HTTP cache (GitHub Pages: 10 minutes) holds fresh copies before we reload.
    const urls = new Set([location.href.split('?')[0], ...performance.getEntriesByType('resource').map((r) => r.name)]);
    await Promise.all([...urls].filter((u) => u.startsWith(location.origin)).map((u) => fetch(u, { cache: 'reload' }).catch(() => {})));
  } catch {}
  location.replace(location.pathname + '?r=' + Date.now());
}

function doExport() {
  const json = exportData();
  const name = `today-backup-${store.state.day.key}.json`;
  const file = new File([json], name, { type: 'application/json' });
  // The share sheet is the nicest path on iPhone (Save to Files, AirDrop…).
  if (navigator.canShare?.({ files: [file] })) {
    navigator.share({ files: [file], title: 'Today backup' }).catch((e) => {
      if (e.name !== 'AbortError') download(file, name);
    });
    return;
  }
  download(file, name);
}

function download(file, name) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast('Backup downloaded');
}
