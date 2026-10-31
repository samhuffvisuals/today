# Today

A daily task list that resets every morning. Open it and the day is already there: your daily tasks are waiting, one tap drops a whole **pack** of tasks (like every step of a new shoot) onto today, the screen shifts from red to green as you check things off, and finishing the day fills the whole phone. It's a static PWA: plain HTML, CSS and JavaScript modules, with no build step, no backend and no accounts. Everything is stored on your phone, in `localStorage`.

## Run it locally

```bash
cd ~/Documents/today
python3 -m http.server 8080
```

Open http://localhost:8080.

- The service worker is **skipped on localhost**, so your edits show up on reload. To test offline mode locally, open http://localhost:8080/?sw.
- On your iPhone over Wi-Fi, open `http://<your-Mac's-IP>:8080`. The app works, haptics included, but offline mode and a real "Add to Home Screen" install need HTTPS, so deploy to try those.
- In the browser console, `__today.store.state` shows all your data.

## Deploy to GitHub Pages (current setup)

This folder is a git repo published with GitHub Pages from the `main` branch root. To ship an update:

1. Bump `VERSION` in `sw.js`.
2. Run:

```bash
cd ~/Documents/today && git add -A && git commit -m "Update" && git push
```

Pages rebuilds in about a minute. The site URL is `https://<your-username>.github.io/today/`. `.nojekyll` tells Pages to serve the files as-is. GitHub Pages ignores `_headers`, which is only for Cloudflare.

## Deploy to Cloudflare Pages (alternative)

**Option A: Wrangler CLI (fastest)**

```bash
cd ~/Documents/today
npx wrangler pages deploy . --project-name today
```

The first run asks you to log in and creates the project. You'll get a URL like `https://today-xyz.pages.dev`. Run the same command again to ship updates.

**Option B: Dashboard drag-and-drop.** In Cloudflare, go to Workers & Pages → Create → Pages → Upload assets, then drag the `today` folder in.

**Option C: Git.** Push this folder to a GitHub repo, then go to Workers & Pages → Create → Pages → Connect to Git. Set the build command to *(none)* and the output directory to `/`.

`_headers` makes sure `sw.js`, `index.html` and the manifest are never stale-cached by the CDN.

### Shipping updates

The service worker caches everything for offline use. **When you change any file, bump `VERSION` in `sw.js`** (for example `today-v2`) before you deploy. The phone downloads the new version in the background, and the next launch uses it. If you add a new JS or CSS file, also add it to the `ASSETS` list in `sw.js`.

## Install on iPhone

1. Open your site URL (`…github.io/today/` or `*.pages.dev`) in **Safari**. It has to be Safari, not Chrome.
2. Tap the **Share** button, then **Add to Home Screen**.
3. Make sure **Open as Web App** is on, then tap **Add**.
4. Launch it from the home screen. It runs full-screen, works offline, and keeps its own storage.

Home-screen apps keep their data separate from Safari and aren't subject to Safari's 7-day storage eviction. Still, use **Settings → Export backup** now and then. On iPhone, Export opens the share sheet, so you can pick *Save to Files*.

## How it works

| File | What it does |
|---|---|
| `js/store.js` | Load/save the single JSON state blob, export/import, the color palette, the first-run starter set (categories, daily tasks, packs) |
| `js/rollover.js` | "Day starts at" logic, history snapshots, carry-over, the days-done counter (pure functions) |
| `js/haptics.js` | `haptic('tap' \| 'success' \| 'snap' \| 'lift' \| 'drop' \| 'celebrate')` |
| `js/actions.js` | Every state change plus the feedback that goes with it, including adding a pack |
| `js/ui/render.js` | Header, the day color (red → green), the mood line, pack chips, progress ring, keyed list rendering with FLIP animations |
| `js/ui/gestures.js` | Swipe to complete/delete, long-press drag to reorder, long-press header |
| `js/ui/sheets.js` | Bottom sheets: quick add, edit task, category editor, pack editor, settings |
| `js/ui/history.js` | "Your days": a five-week calendar of wins |
| `js/ui/effects.js` | Particle burst, confetti, the full-screen DONE finish |
| `js/ui/toast.js` | Undo toast |

**The daily reset.** A PWA can't run in the background, so the app checks the date whenever it opens, comes back to the foreground, or every 30 s while it's open. If the logical day has changed, it:

1. saves yesterday's done/total to history
2. fills in any skipped days as 0%
3. deletes finished one-off tasks
4. offers unfinished one-offs with a one-tap **Carry to today** card

With the default 4:00 AM start, 1:30 AM still counts as yesterday.

**Packs.** A pack is a named list of tasks (`New shoot`, `Clean house`, `Trip`). Tapping its chip adds every item to today as one-off tasks, skipping any that are already on the list. Edit packs in **Settings → Packs**.

**Days done.** The counter at the top only ever goes up: it's the number of days you finished everything. A missed day adds nothing and takes nothing away, and the history calendar only shows the days you made progress. There is no streak on purpose.

**Day color.** The accent color moves from red (nothing done) through orange and yellow to green (100%). It's a registered CSS custom property (`--accent`) so it animates, and it tints the glow at the top, the ring and the mood line.

## Haptics on iOS

iOS Safari has no `navigator.vibrate`. The one way to get a system haptic on the web is an `<input type="checkbox" switch>` being toggled by a **trusted** click. Since WebKit's May 2026 change (iOS 26.5 and later), toggling the switch from JavaScript with `label.click()` plays nothing, which is why the first version of this app was silent on a real phone.

So on iOS, `js/haptics.js` lays a transparent `<label>` over every button (and anything with `data-haptic`), with a hidden switch inside. Your finger lands on the label, WebKit forwards a trusted click to the switch, and iOS plays the switch haptic. The original click still bubbles to the button, so nothing else changes. A `MutationObserver` adds the overlay to anything rendered later.

What to expect on an iPhone:

| Action | Haptic |
|---|---|
| Tapping anything: checks, pack chips, the + button, sheet buttons, chips, toggles, calendar days | one system tick |
| Swipe to complete or delete, long-press to reorder | silent (no click happens, and iOS only plays haptics for real taps) |
| Finishing the day | the tick from the last check; tapping the DONE screen to dismiss ticks too |

There is no way to make the tick stronger or play a pattern. If taps are silent, check **Settings → Sounds & Haptics → System Haptics** on the phone, and the **Haptics** toggle in the app's settings. Android uses `navigator.vibrate` patterns; other browsers are silent.
