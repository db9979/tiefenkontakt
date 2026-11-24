import type { ServerMsg } from '@tk/shared';
import { net } from '../net.js';
import { store } from '../store.js';
import { h } from './format.js';
import { qrSvg } from './qr.js';

/**
 * The PC side of the phone view: a button that shows a QR code with a one-time link, and the
 * phone's input (where it looks, what it selected, a photo) for the bridge and the periscope.
 */

interface Look { bearing: number; elev: number; mag: number; glass: boolean; at: number }
const state = { on: false, look: undefined as Look | undefined, photo: false };
let overlay: HTMLElement | undefined;

net.on((m: ServerMsg) => {
  if (m.t === 'phone') {
    state.on = m.ev === 'on';
    if (!state.on) state.look = undefined;
    paintStatus();
    document.querySelectorAll<HTMLButtonElement>('[data-phone]').forEach((b) => b.classList.toggle('on', state.on));
  } else if (m.t === 'phone_look') state.look = { ...m, at: performance.now() };
  else if (m.t === 'phone_select') store.selected = m.label;
  else if (m.t === 'phone_photo') state.photo = true;
  else if (m.t === 'phone_link' && overlay) {
    const url = `${location.origin}/#phone=${m.code}`;
    overlay.querySelector('#ph-qr')!.innerHTML = qrSvg(url, 240);
    overlay.querySelector('#ph-url')!.textContent = url;
  }
});

function paintStatus(): void {
  const st = overlay?.querySelector('#ph-st');
  if (st) st.innerHTML = state.on ? '<span>HANDY VERBUNDEN · DIE ANSICHT FOLGT DEM HANDY</span>' : '<span class="dim">WARTE AUF DAS HANDY …</span>';
}

/** Where the phone looks, while it is fresh (it sends a few times a second). */
export function phoneLook(): Look | undefined {
  return state.look && performance.now() - state.look.at < 1500 ? state.look : undefined;
}

/** A photo the phone asked for (taken by the station, once). */
export function phonePhoto(): boolean {
  const p = state.photo;
  state.photo = false;
  return p;
}

/** "Aufs Handy" button for a 3D station. */
export function phoneButton(): HTMLButtonElement {
  const b = h('<button data-phone title="Die 3D-Ansicht aufs Handy: QR-Code scannen, dann mit dem Handy umschauen (Kreisel)">📱 Handy</button>') as HTMLButtonElement;
  b.classList.toggle('on', state.on);
  b.onclick = () => openOverlay();
  return b;
}

function openOverlay(): void {
  overlay?.remove();
  overlay = h(`<div class="overlay"><div class="panel plain" style="max-width:340px;text-align:center">
    <div class="hd"><span>3D-Ansicht aufs Handy</span><button id="ph-x" style="padding:0 8px">✕</button></div>
    <div id="ph-qr" style="display:flex;justify-content:center;padding:8px;background:#fff;border-radius:4px;min-height:240px"></div>
    <div id="ph-url" class="dim" style="word-break:break-all;font-size:0.8333rem;margin:6px 0"></div>
    <div id="ph-st" style="margin:6px 0"></div>
    <div class="dim" style="line-height:1.45;text-align:left">Mit der Handy-Kamera scannen. Das Handy zeigt Sehrohr oder Fernglas; umschauen durch Drehen und Neigen, zoomen mit zwei Fingern. Der Code gilt 10 Minuten und nur einmal; die Ansicht hier folgt dem Handy.</div>
  </div></div>`);
  document.body.appendChild(overlay);
  overlay.querySelector<HTMLButtonElement>('#ph-x')!.onclick = () => {
    overlay?.remove();
    overlay = undefined;
  };
  paintStatus();
  net.send({ t: 'phone_link' });
}
