(function () {
  var t = 'dark';
  try { t = localStorage.getItem('hub-theme'); } catch (e) {}
  if (t !== 'light' && t !== 'dark') t = matchMedia('(prefers-color-scheme:light)').matches ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
})();
