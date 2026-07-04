// theme-switcher.js — wiring for the fixed theme-picker toolbar declared in index.html.
//
// Exactly the pattern from _docs/manual/07-personalizing-controls.md §4: switching themes at
// runtime is a single attribute write on <html>. No stylesheet swap, no component re-render —
// every --sa-* rule in themes.css gated behind [data-theme='...'] just starts resolving to
// different values instantly.

export const initThemeSwitcher = () => {
  function setTheme(name) {
    document.documentElement.dataset.theme = name;
    localStorage.setItem('theme', name); // optional: remember the choice
  }

  const switcher = document.getElementById('theme-switcher');
  const buttons = switcher.querySelectorAll('[data-theme-choice]');

  function highlightActive(name) {
    buttons.forEach((btn) => {
      btn.classList.toggle('theme-switcher__btn--active', btn.dataset.themeChoice === name);
    });
  }

  switcher.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-theme-choice]');
    if (!btn) return;
    const name = btn.dataset.themeChoice;
    setTheme(name);
    highlightActive(name);
  });

  // Restore the previously chosen theme on load (falls back to 'light').
  const savedTheme = localStorage.getItem('theme') || 'light';
  setTheme(savedTheme);
  highlightActive(savedTheme);
};

export default initThemeSwitcher;
