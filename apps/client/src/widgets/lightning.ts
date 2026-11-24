/**
 * Lightning seen in the 3D view, passed on to whoever wants to hear it (the thunder in
 * audio.ts). A plain hook so the sound side does not pull in three.js.
 */
let hook: ((distanceM: number) => void) | undefined;

export function onLightning(fn: ((distanceM: number) => void) | undefined): void {
  hook = fn;
}

export function lightningSeen(distanceM: number): void {
  hook?.(distanceM);
}
