(() => {
  const root = document.documentElement;
  let saved;
  try { saved = localStorage.getItem('drive-watcher-theme'); } catch {}
  if (saved === 'dark' || saved === 'light') {
    root.dataset.theme = saved;
    root.setAttribute('data-theme-preference', '');
  } else {
    root.dataset.theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
})();
