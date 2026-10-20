// Haptics.
//
// iOS Safari has no navigator.vibrate. Since iOS 18, toggling an
// <input type="checkbox" switch> plays the system "switch" haptic, and that
// works for a programmatic label.click() as long as it runs inside a user
// gesture (click, touchend, keydown). It does NOT fire from touchmove or a
// timer, so "snap" (mid-swipe) and "lift" (long-press timer) are usually
// silent on iOS, and the follow-up ticks in "success"/"celebrate" (setTimeout)
// may be dropped. Use Settings → Haptics test to check on your phone.
//
// Android uses navigator.vibrate with real patterns. Everything else: silent.

const PATTERNS = {
  tap: { ios: [0], android: 10 },
  success: { ios: [0, 90], android: [12, 70, 22] },
  snap: { ios: [0], android: 8 },
  lift: { ios: [0], android: 18 },
  drop: { ios: [0], android: 12 },
  celebrate: { ios: [0, 110, 220, 440], android: [20, 60, 20, 60, 40, 120, 90] },
};

export const HAPTIC_NAMES = Object.keys(PATTERNS);

let enabled = true;
let label = null;
const canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

export function setHapticsEnabled(v) {
  enabled = !!v;
}

function tick() {
  try {
    if (!label) {
      label = document.createElement('label');
      label.setAttribute('aria-hidden', 'true');
      label.style.display = 'none';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('switch', '');
      input.tabIndex = -1;
      label.appendChild(input);
      document.body.appendChild(label);
    }
    label.click();
  } catch {
    /* fail silently */
  }
}

export function haptic(name, { force = false } = {}) {
  if (!enabled && !force) return;
  const p = PATTERNS[name];
  if (!p) return;
  if (canVibrate) {
    try { navigator.vibrate(p.android); } catch {}
    return;
  }
  // First tick must be synchronous to stay inside the gesture.
  tick();
  for (const t of p.ios.slice(1)) setTimeout(tick, t);
}
