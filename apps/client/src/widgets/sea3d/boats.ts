import * as THREE from 'three';
import type { ClassId } from '@tk/shared';
import { M, add, box, cyl, wake } from './parts.js';

/**
 * Surfaced submarines after the period's real hull forms (names stay fictional):
 * Project 9 like a big teardrop SSN with a low, long sail and the towed-array pod on top of
 * the rudder fin; Project 4 like a fat Kilo-type hull with the sail well forward; Project 2
 * like a small coastal boat with a tall narrow sail; Project 6 like a modern AIP boat with
 * sail planes and an X-rudder. About 45 % of the hull shows above the water.
 */

interface Form {
  len: number;
  r: number;
  /** Sail: centre position along the hull (fraction of len, + = forward), length, height. */
  sailAt: number;
  sailLen: number;
  sailH: number;
  /** Planes on the sail (else bow planes), X-rudder (else cross), towed-array pod on the fin. */
  sailPlanes?: boolean;
  xRudder?: boolean;
  pod?: boolean;
  /** Length of the tapered tail cone as a fraction of len. */
  tail: number;
}

const FORMS: Partial<Record<ClassId, Form>> = {
  ssn: { len: 100, r: 5.4, sailAt: 0.2, sailLen: 15, sailH: 5.5, tail: 0.3, pod: true },
  ssk: { len: 72, r: 4.8, sailAt: 0.12, sailLen: 13, sailH: 6.5, tail: 0.22 },
  ssc: { len: 48, r: 2.4, sailAt: 0.08, sailLen: 7, sailH: 5, tail: 0.18, sailPlanes: false },
  ssa: { len: 60, r: 3.1, sailAt: 0.14, sailLen: 9, sailH: 5.5, tail: 0.2, sailPlanes: true, xRudder: true },
};

export function surfacedBoat(g: THREE.Group, cls: ClassId): void {
  const f = FORMS[cls] ?? FORMS.ssk!;
  const { len, r } = f;
  const cy = -r * 0.55;
  const top = cy + r;
  const body = len * (1 - f.tail) - r;
  // Parallel mid-body, round bow, long tapered tail cone
  const mid = cyl(g, r, body, 0, cy, len / 2 - r - body / 2, M.sub);
  mid.rotation.x = Math.PI / 2;
  const bow = add(g, new THREE.SphereGeometry(r, 14, 10), M.sub, 0, cy, len / 2 - r);
  bow.scale.set(1, 1, 1.3);
  const tailLen = len * f.tail;
  const tailZ = len / 2 - r - body - tailLen / 2;
  const tail = add(g, new THREE.CylinderGeometry(r, r * 0.12, tailLen, 14), M.sub, 0, cy, tailZ);
  // Wide end (top of the cylinder) toward the bow
  tail.rotation.x = Math.PI / 2;
  // Rudders at the end of the tail: cross or X, with the towed-array pod on the upper fin
  const finZ = tailZ - tailLen * 0.32;
  const span = r * 1.35;
  const fins = new THREE.Group();
  fins.position.set(0, cy, finZ);
  box(fins, 0.4, span * 2, len * 0.07, 0, 0, 0, M.sub);
  box(fins, span * 2, 0.4, len * 0.07, 0, 0, 0, M.sub);
  if (f.xRudder) fins.rotation.z = Math.PI / 4;
  g.add(fins);
  if (f.pod) cyl(g, r * 0.24, len * 0.08, 0, cy + span, finZ, M.sub).rotation.x = Math.PI / 2;
  // Flat casing on top of the hull
  box(g, r * 0.9, 0.4, body * 0.9, 0, top - 0.1, len / 2 - r - body / 2, M.sub);
  // Sail standing on the casing, planes on the sail or at the bow, mast heads on top
  const sz = len * f.sailAt;
  box(g, r * 0.55, f.sailH, f.sailLen, 0, top + f.sailH / 2 - 0.3, sz, M.sub);
  const sailTop = top + f.sailH - 0.3;
  if (f.sailPlanes) box(g, r * 2.6, 0.35, 2, 0, sailTop - 1.6, sz + f.sailLen * 0.15, M.sub);
  else box(g, r * 2.4, 0.3, 1.6, 0, cy + r * 0.3, len / 2 - r * 1.6, M.sub);
  for (const x of [-0.5, 0.5]) cyl(g, 0.16, 2.4, x, sailTop + 1.2, sz, M.black);
  wake(g, len * 0.9, r * 1.7, len / 2 + 2, -len / 2);
}
