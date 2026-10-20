import { esc } from './icons.js';

let current = null;

// One toast at a time. A new toast replaces the old one (its undo just expires).
export function toast(message, { action, onAction, duration = 5000 } = {}) {
  current?.dismiss();
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span class="toast-msg">${esc(message)}</span>${
    action ? `<button class="toast-btn" type="button">${esc(action)}</button>` : ''
  }<i class="toast-bar" style="animation-duration:${duration}ms"></i>`;
  root.appendChild(el);
  el.getBoundingClientRect();
  el.classList.add('show');

  let gone = false;
  const dismiss = () => {
    if (gone) return;
    gone = true;
    clearTimeout(timer);
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
    if (current?.el === el) current = null;
  };
  const timer = setTimeout(dismiss, duration);
  el.querySelector('.toast-btn')?.addEventListener('click', () => {
    dismiss();
    onAction?.();
  });
  current = { el, dismiss };
  return current;
}
