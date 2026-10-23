// Runs before first paint (external file so the CSP can stay script-src 'self').
// Prevents the light/dark flash by applying the saved theme + accent immediately.
(function () {
  try {
    var s = JSON.parse(localStorage.getItem('la:settings:v2') || '{}');
    var t = s.theme || 'system';
    if (t === 'system') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.dataset.theme = t;
    if (s.accent) document.documentElement.style.setProperty('--accent', s.accent);
  } catch (e) {}
})();
