import { distance, type Snapshot, type Vec2 } from '@tk/shared';
import { store } from '../store.js';
import { btnState } from './btn-state.js';
import { isFriendlyContact } from './friendly.js';

/**
 * A guarded fire button: when a check finds a reason to hesitate (target is our own or a
 * friendly ship, the solution is weak, no target at all), the first press only arms the button
 * and shows the warning on it; a second press within a few seconds fires. With nothing to
 * shoot at the button refuses. Same pattern as "Wirklich verlassen?".
 */
export interface GuardCheck {
  /** No target: refuse with this text. */
  block?: string;
  /** Doubt: ask for a second press with this text. */
  warn?: string;
}

const ARM_S = 3;

export function guardFire(btn: HTMLButtonElement, check: () => GuardCheck, fire: () => void): void {
  let armedAt = 0;
  let armedFor = '';
  btn.addEventListener('click', () => {
    const c = check();
    if (c.block) {
      flash(btn, c.block);
      return;
    }
    const now = performance.now();
    if (c.warn && !(armedFor === c.warn && now - armedAt < ARM_S * 1000)) {
      armedAt = now;
      armedFor = c.warn;
      btn.dataset.guard = '1';
      btnState(btn, { label: `${c.warn} – NOCHMAL`, tone: 'warn', force: true });
      setTimeout(() => {
        if (armedAt === now) {
          armedFor = '';
          delete btn.dataset.guard;
          btnState(btn, { label: '', force: true });
        }
      }, ARM_S * 1000);
      return;
    }
    armedFor = '';
    armedAt = 0;
    delete btn.dataset.guard;
    btnState(btn, { label: '', force: true });
    fire();
  });
}

function flash(btn: HTMLButtonElement, text: string): void {
  btn.dataset.guard = '1';
  btnState(btn, { label: text, tone: 'empty', force: true });
  setTimeout(() => {
    delete btn.dataset.guard;
    btnState(btn, { label: '', force: true });
  }, 1800);
}

/** Friendly or own ships (convoy, escorts, mates as last reported) within this distance of a point. */
export function friendNear(s: Snapshot, p: Vec2, within = 1500): boolean {
  return s.friendlies.some((f) => f.alive && distance(f, p) < within);
}

/** The usual check: a target must be selected; doubt when it is ours or friends are near the aim point. */
export function targetCheck(aimPoint?: Vec2): GuardCheck {
  const s = store.snap;
  const c = store.selectedContact();
  if (!s || !c) return { block: 'KEIN ZIEL' };
  if (isFriendlyContact(c, s)) return { warn: 'EIGENES SCHIFF' };
  if (aimPoint && friendNear(s, aimPoint)) return { warn: 'EIGENE IN DER NÄHE' };
  return {};
}
