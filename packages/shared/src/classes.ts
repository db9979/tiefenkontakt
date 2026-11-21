/** Fictional Cold-War-era platform classes. All numbers are game-balance values, tunable. */

export type ClassId = 'ssn' | 'ssk' | 'ffg' | 'merchant';
export type Team = 'west' | 'east' | 'neutral';

export interface HullSonarSpec {
  di: number; // directivity index dB
  baffleHalfAngle: number; // deg, blind sector astern (+/-)
  selfNoiseBase: number; // dB at selfNoiseRefKn
  selfNoiseRefKn: number;
  activeSl?: number; // active source level dB, if capable
}

export interface TowedArraySpec {
  di: number;
  selfNoise: number; // dB, nearly speed independent until maxSpeedKn
  maxSpeedKn: number; // above this the array is useless (flow noise)
  maxLength: number; // m
  settleTime: number; // s needed on steady course after a turn
}

export interface ClassSpec {
  id: ClassId;
  name: string;
  team: Team;
  submarine: boolean;
  tonnage: number;
  maxSpeedKn: number;
  accel: number; // m/s^2
  turnRateDeg: number; // deg/s at full rudder (scaled down at low speed)
  maxDepth: number; // m (0 for surface ships)
  depthRate: number; // m/s
  draft: number; // m, used as depth for surface ships
  /** Broadband radiated noise: sl = slBase + slSlope*log10(v/slRefKn). */
  slBase: number;
  slRefKn: number;
  slSlope: number;
  /** Cavitation onset speed at surface, increases with depth by cavDepthKn per 100 m. */
  cavKn?: number;
  cavDepthKn?: number;
  targetStrength: number; // dB, for active sonar
  hull: HullSonarSpec;
  towed?: TowedArraySpec;
  battery?: { capacityKnH: number }; // SSK: knot-hours of submerged running at slow speed
  hp: number;
}

export const CLASSES: Record<ClassId, ClassSpec> = {
  ssn: {
    id: 'ssn', name: 'Atom-U-Boot Projekt 9', team: 'east', submarine: true, tonnage: 5200,
    maxSpeedKn: 30, accel: 0.12, turnRateDeg: 1.6, maxDepth: 400, depthRate: 2.5, draft: 0,
    slBase: 125, slRefKn: 5, slSlope: 50, cavKn: 9, cavDepthKn: 5,
    targetStrength: 15,
    hull: { di: 16, baffleHalfAngle: 30, selfNoiseBase: 58, selfNoiseRefKn: 5, activeSl: 215 },
    towed: { di: 22, selfNoise: 48, maxSpeedKn: 12, maxLength: 600, settleTime: 60 },
    hp: 100,
  },
  ssk: {
    id: 'ssk', name: 'Diesel-U-Boot Projekt 4', team: 'east', submarine: true, tonnage: 2300,
    maxSpeedKn: 18, accel: 0.1, turnRateDeg: 2.2, maxDepth: 300, depthRate: 2, draft: 0,
    slBase: 115, slRefKn: 4, slSlope: 50, cavKn: 7, cavDepthKn: 4,
    targetStrength: 12,
    hull: { di: 15, baffleHalfAngle: 30, selfNoiseBase: 55, selfNoiseRefKn: 4, activeSl: 210 },
    battery: { capacityKnH: 400 },
    hp: 80,
  },
  ffg: {
    id: 'ffg', name: 'Fregatte F-12', team: 'west', submarine: false, tonnage: 3800,
    maxSpeedKn: 28, accel: 0.15, turnRateDeg: 2.5, maxDepth: 0, depthRate: 0, draft: 6,
    slBase: 150, slRefKn: 15, slSlope: 45,
    targetStrength: 25,
    hull: { di: 15, baffleHalfAngle: 30, selfNoiseBase: 72, selfNoiseRefKn: 15, activeSl: 225 },
    towed: { di: 24, selfNoise: 48, maxSpeedKn: 14, maxLength: 1200, settleTime: 60 },
    hp: 100,
  },
  merchant: {
    id: 'merchant', name: 'Frachter', team: 'west', submarine: false, tonnage: 12000,
    maxSpeedKn: 14, accel: 0.04, turnRateDeg: 0.8, maxDepth: 0, depthRate: 0, draft: 9,
    slBase: 160, slRefKn: 10, slSlope: 40,
    targetStrength: 30,
    hull: { di: 0, baffleHalfAngle: 180, selfNoiseBase: 90, selfNoiseRefKn: 10 },
    hp: 60,
  },
};

export function classSpec(id: ClassId): ClassSpec {
  return CLASSES[id];
}
