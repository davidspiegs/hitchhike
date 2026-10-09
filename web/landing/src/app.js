import { initHandoffDemo, initStarterPrompt } from './demo.js';

initHandoffDemo();
initStarterPrompt();
initSignInPreload();

function initSignInPreload() {
  // The hosted build supplies the public origin; standalone landing previews do not load auth assets.
  const assets = document.querySelector('meta[name="hitchhike-sign-in-assets"]')?.content;
  if (!assets) return;
  let warmed = false;
  function warm() {
    const connection = navigator.connection;
    if (warmed || connection?.saveData || ['slow-2g', '2g'].includes(connection?.effectiveType)) return;
    warmed = true;
    // Link hints fetch bytes without executing the SDK or touching an auth session.
    for (const url of assets.split(/\s+/)) {
      const hint = document.createElement('link');
      hint.rel = 'preload'; hint.as = 'script'; hint.href = url;
      hint.crossOrigin = 'anonymous'; hint.fetchPriority = 'low';
      document.head.appendChild(hint);
    }
  }
  for (const link of document.querySelectorAll('a[href="/sign-in"]')) {
    link.addEventListener('pointerenter', warm, { passive: true });
    link.addEventListener('focus', warm, { passive: true });
    link.addEventListener('touchstart', warm, { passive: true });
  }
}
