const media = matchMedia('(prefers-color-scheme: dark)');

function syncMeta() {
  const bg = getComputedStyle(document.body).backgroundColor;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  requestAnimationFrame(syncMeta);
}

media.addEventListener?.('change', () => requestAnimationFrame(syncMeta));
