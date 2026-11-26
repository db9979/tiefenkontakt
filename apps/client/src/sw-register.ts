import { h } from './widgets/format.js';

/** True in production builds (vite define). */
declare const __PROD__: boolean;

/**
 * Registers the service worker (production builds only). When a new build has finished
 * downloading in the background, a small banner offers to switch over; the page never
 * reloads on its own, so nobody is thrown out of a running match.
 */
export function registerServiceWorker(inMatch: () => boolean): void {
  if (!__PROD__ || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').then((reg) => {
      const offer = (w: ServiceWorker) => {
        if (!navigator.serviceWorker.controller || document.querySelector('.update-banner')) return;
        const b = h(`<button class="update-banner" title="Die neue Version ist schon geladen">Neue Version · neu laden</button>`);
        b.onclick = () => {
          if (inMatch() && !confirm('Neu laden? Dein Schiff wartet so lange, bis du wieder da bist.')) return;
          w.postMessage('skip-waiting');
        };
        document.body.appendChild(b);
      };
      if (reg.waiting) offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => w.state === 'installed' && offer(w));
      });
      // Look for a new build now and then (long sessions)
      setInterval(() => void reg.update(), 30 * 60_000);
    });
    let reloading = false;
    // The very first install also takes control (clients.claim): that is no new version, and
    // reloading then would throw a first-time player out of the login, lobby or even a match
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading || !hadController) return;
      reloading = true;
      location.reload();
    });
  });
}
