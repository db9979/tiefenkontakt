/** Fictional Cold-War-era platform classes. All numbers are game-balance values, tunable. */

export type ClassId = 'ssn' | 'ssk' | 'ssc' | 'ffg' | 'kor' | 'merchant';
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
  accel: number; // m/s^2 (gaining speed; slowing down is a bit quicker)
  turnRateDeg: number; // deg/s ceiling at full rudder
  /** Turning radius at full rudder (m): the turn rate is speed / radius, so slow ships turn slowly. */
  turnRadius: number;
  maxDepth: number; // m (0 for surface ships)
  depthRate: number; // m/s ceiling for depth changes
  /** Dive/rise angle on the planes (deg): vertical speed is speed · sin(angle), plus a little from trim and ballast. */
  planeAngleDeg?: number;
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
    maxSpeedKn: 30, accel: 0.055, turnRateDeg: 1.8, turnRadius: 450, maxDepth: 400, depthRate: 1.5, planeAngleDeg: 15, draft: 0,
    slBase: 125, slRefKn: 5, slSlope: 50, cavKn: 9, cavDepthKn: 5,
    targetStrength: 15,
    hull: { di: 16, baffleHalfAngle: 30, selfNoiseBase: 58, selfNoiseRefKn: 5, activeSl: 215 },
    towed: { di: 22, selfNoise: 48, maxSpeedKn: 12, maxLength: 600, settleTime: 60 },
    hp: 100,
  },
  ssk: {
    id: 'ssk', name: 'Diesel-U-Boot Projekt 4', team: 'east', submarine: true, tonnage: 2300,
    maxSpeedKn: 18, accel: 0.05, turnRateDeg: 2, turnRadius: 300, maxDepth: 300, depthRate: 1.2, planeAngleDeg: 15, draft: 0,
    slBase: 115, slRefKn: 4, slSlope: 50, cavKn: 7, cavDepthKn: 4,
    targetStrength: 12,
    hull: { di: 15, baffleHalfAngle: 30, selfNoiseBase: 55, selfNoiseRefKn: 4, activeSl: 210 },
    battery: { capacityKnH: 80 },
    hp: 80,
  },
  ffg: {
    id: 'ffg', name: 'Fregatte F-12', team: 'west', submarine: false, tonnage: 3800,
    maxSpeedKn: 28, accel: 0.13, turnRateDeg: 2.2, turnRadius: 400, maxDepth: 0, depthRate: 0, draft: 6,
    slBase: 150, slRefKn: 15, slSlope: 45,
    targetStrength: 25,
    hull: { di: 15, baffleHalfAngle: 30, selfNoiseBase: 72, selfNoiseRefKn: 15, activeSl: 225 },
    towed: { di: 24, selfNoise: 48, maxSpeedKn: 14, maxLength: 1200, settleTime: 60 },
    hp: 100,
  },
  ssc: {
    id: 'ssc', name: 'Küsten-U-Boot Projekt 2', team: 'east', submarine: true, tonnage: 900,
    maxSpeedKn: 14, accel: 0.06, turnRateDeg: 2.6, turnRadius: 200, maxDepth: 200, depthRate: 1.2, planeAngleDeg: 15, draft: 0,
    slBase: 108, slRefKn: 4, slSlope: 50, cavKn: 6, cavDepthKn: 4,
    targetStrength: 8,
    hull: { di: 12, baffleHalfAngle: 35, selfNoiseBase: 54, selfNoiseRefKn: 4, activeSl: 205 },
    battery: { capacityKnH: 45 },
    hp: 60,
  },
  kor: {
    id: 'kor', name: 'Korvette K-7', team: 'west', submarine: false, tonnage: 1800,
    maxSpeedKn: 26, accel: 0.15, turnRateDeg: 2.8, turnRadius: 300, maxDepth: 0, depthRate: 0, draft: 4,
    slBase: 142, slRefKn: 15, slSlope: 45,
    targetStrength: 21,
    hull: { di: 14, baffleHalfAngle: 30, selfNoiseBase: 68, selfNoiseRefKn: 15, activeSl: 220 },
    towed: { di: 20, selfNoise: 50, maxSpeedKn: 14, maxLength: 600, settleTime: 45 },
    hp: 70,
  },
  merchant: {
    id: 'merchant', name: 'Frachter', team: 'west', submarine: false, tonnage: 12000,
    maxSpeedKn: 14, accel: 0.03, turnRateDeg: 0.8, turnRadius: 350, maxDepth: 0, depthRate: 0, draft: 9,
    slBase: 160, slRefKn: 10, slSlope: 40,
    targetStrength: 30,
    hull: { di: 0, baffleHalfAngle: 180, selfNoiseBase: 90, selfNoiseRefKn: 10 },
    hp: 110,
  },
};

export function classSpec(id: ClassId): ClassSpec {
  return CLASSES[id];
}

/** Surface warship escorting the convoy (frigate or corvette). */
export function isEscort(cls: ClassId): boolean {
  return cls === 'ffg' || cls === 'kor';
}

/** Carries a helicopter (dipping sonar, sonobuoys, helo torpedoes). */
export function hasHelicopter(cls: ClassId): boolean {
  return cls === 'ffg';
}
