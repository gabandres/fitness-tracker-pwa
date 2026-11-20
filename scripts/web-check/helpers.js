// Paste this whole file as ONE evaluate call after every navigation or reload
// (a new document forgets it). It returns the test ids on the page.
//
//   __q(id)        the last element with that testID, or null
//   __click(id)    click it; false when it is not on the page
//   __text(id)     its visible text, or null
//   __ids()        every testID on the page
//   __wait(ms)     a promise that resolves after ms
//   __until(id, ms = 13000)   resolves true when the testID appears, false on timeout
//
// A script longer than the 15 s evaluate limit: start it without awaiting,
// push progress to window.__log, and read window.__log in a later call.
(() => {
  window.__q = (id) => {
    const all = document.querySelectorAll('[data-testid="' + id + '"]');
    return all[all.length - 1] || null;
  };
  window.__click = (id) => {
    const el = window.__q(id);
    if (!el) return false;
    el.click();
    return true;
  };
  window.__text = (id) => {
    const el = window.__q(id);
    return el ? el.innerText : null;
  };
  window.__ids = () => [...document.querySelectorAll('[data-testid]')].map((e) => e.getAttribute('data-testid'));
  window.__wait = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__until = (id, ms = 13000) =>
    new Promise((resolve) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        const found = !!window.__q(id);
        if (found || Date.now() - t0 > ms) {
          clearInterval(iv);
          resolve(found);
        }
      }, 250);
    });
  window.__log = window.__log || [];
  // The dev error toast and overlay sit over the bottom button.
  if (!document.getElementById('web-check-style')) {
    const style = document.createElement('style');
    style.id = 'web-check-style';
    style.textContent = '#error-toast,#error-overlay{display:none!important}';
    document.head.appendChild(style);
  }
  return { url: location.href, ids: window.__ids().length };
})();
