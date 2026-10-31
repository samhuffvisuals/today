// Haptics.
//
// iOS Safari has no navigator.vibrate. The only way to get a system haptic on
// the web is an <input type="checkbox" switch> (Safari 17.4+) being toggled by
// a TRUSTED click. Since WebKit's May 2026 change (iOS 26.5+), toggling it from
// JavaScript (label.click()) plays nothing, which is why the old version of this
// app was silent.
//
// So on iOS every tappable control gets a transparent <label> laid over it with
// a hidden switch inside. The finger lands on the label, WebKit forwards a
// trusted click to the switch, and the system plays the haptic. The original
// click still bubbles from the label to the control, so handlers don't change.
// The forwarded click on the switch is stopped so nothing runs twice. Submit
// buttons are avoided (type="button" + a click handler) so the native submit
// can't fire a second time behind the label.
//
// Limits: one tick per real tap, no patterns. Swipes and long-presses end
// without a click, so they stay silent on iOS. Android uses navigator.vibrate.

const HOSTS = 'button, summary, [data-haptic]';

const ANDROID = {
  tap: 10,
  success: [12, 70, 22],
  snap: 8,
  lift: 18,
  drop: 12,
  celebrate: [20, 60, 20, 60, 40, 120, 90],
};

const ua = navigator.userAgent || '';
const isIOS = /iP(hone|ad|od)/.test(ua) || (navigator.vendor === 'Apple Computer, Inc.' && navigator.maxTouchPoints > 1);
export const overlayHaptics = isIOS && navigator.maxTouchPoints > 0;
const canVibrate = !isIOS && typeof navigator.vibrate === 'function';

let enabled = true;

export function setHapticsEnabled(v) {
  enabled = !!v;
  document.documentElement.classList.toggle('no-haptics', !enabled);
}

// Android patterns. On iOS this is a no-op: the overlay labels do the work.
export function haptic(name) {
  if (!enabled || !canVibrate) return;
  try { navigator.vibrate(ANDROID[name] ?? 10); } catch {}
}

/* ---------- iOS overlays ---------- */

// Diagnostics for Settings: real taps on overlays, and trusted clicks forwarded to a switch.
export const stats = { taps: 0, forwarded: 0 };

function onSwitchClick(e) {
  if (e.isTrusted) stats.forwarded++;
  e.stopPropagation(); // the control already handled the real click
}

function attach(host) {
  if (host.hasAttribute('data-no-haptic') || host.querySelector(':scope > label.hap')) return;
  host.classList.add('hap-host');
  const l = document.createElement('label');
  l.className = 'hap';
  l.setAttribute('aria-hidden', 'true');
  // The switch must never sit under the finger: WebKit marks a touchstart on a
  // switch as handled, which cancels scrolling. visibility:hidden keeps it out
  // of hit testing while it still has a renderer, which the haptic needs.
  const sw = document.createElement('input');
  sw.type = 'checkbox';
  sw.setAttribute('switch', '');
  sw.addEventListener('click', onSwitchClick);
  l.appendChild(sw);
  host.appendChild(l);
}

function scan(node) {
  if (node.nodeType !== 1) return;
  if (node.matches(HOSTS)) attach(node);
  node.querySelectorAll(HOSTS).forEach(attach);
}

export function installHaptics(root = document.body) {
  if (!overlayHaptics) return;
  document.documentElement.classList.add('ios-haptics');
  scan(root);
  new MutationObserver((muts) => {
    for (const m of muts) m.addedNodes.forEach(scan);
  }).observe(root, { childList: true, subtree: true });
  document.addEventListener('click', (e) => {
    if (e.isTrusted && e.target.matches?.('label.hap')) stats.taps++;
  }, true);
}
