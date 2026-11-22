import { depthAt, headingVec, type Snapshot } from '@tk/shared';
import { drawAir } from './air-symbols.js';

/**
 * Surface-search radar PPI as a phosphor tube: returns are written into a persistence
 * layer as the sweep passes (sea clutter, rain, coastline from the chart, contacts) and
 * fade until the next revolution. Bezel with bearing ring and ship's-head marker on top.
 */

const S = 560; // persistence layer size (px)
const C = S / 2;
const R = 262;
const TAU = Math.PI * 2;
const toRad = (deg: number) => ((deg - 90) * Math.PI) / 180;

export class RadarScope {
  private phos = document.createElement('canvas');
  private pc: CanvasRenderingContext2D;
  sweep = 0;

  constructor() {
    this.phos.width = S;
    this.phos.height = S;
    this.pc = this.phos.getContext('2d')!;
    this.pc.fillStyle = '#020605';
    this.pc.fillRect(0, 0, S, S);
  }

  /** Advance the sweep and burn new returns into the phosphor. */
  update(s: Snapshot | undefined, dt: number, rpm: number, rangeM: number): void {
    const pc = this.pc;
    pc.save();
    pc.beginPath(); pc.arc(C, C, R, 0, TAU); pc.clip();
    // Persistence: a full revolution fades the picture to a faint afterglow
    pc.fillStyle = `rgba(2,6,5,${Math.min(0.5, dt * (rpm / 60) * 2.2)})`;
    pc.fillRect(0, 0, S, S);
    const on = !!s?.own.radarOn;
    if (!on || !s) {
      // Standby: receiver noise only
      for (let i = 0; i < 30; i++) {
        pc.fillStyle = `rgba(93,202,165,${Math.random() * 0.12})`;
        pc.fillRect(Math.random() * S, Math.random() * S, 1, 1);
      }
      pc.restore();
      return;
    }
    const prev = this.sweep;
    this.sweep = (this.sweep + dt * rpm * 6) % 360;
    const span = (this.sweep - prev + 360) % 360;
    const steps = Math.max(1, Math.ceil(span / 0.6));
    const scale = R / rangeM;
    for (let k = 0; k < steps; k++) {
      const brg = prev + (span * (k + Math.random())) / steps;
      const a = toRad(brg);
      const ca = Math.cos(a), sa = Math.sin(a);
      // Sea clutter: dense close in, growing with sea state; rain adds a speckled band
      const clutter = (20 + s.env.seaState * 14) * (6 * 1852 / rangeM);
      for (let i = 0; i < 6; i++) {
        const rr = Math.pow(Math.random(), 2.2) * clutter;
        pc.fillStyle = `rgba(110,220,180,${0.18 + Math.random() * 0.35})`;
        pc.fillRect(C + ca * rr, C + sa * rr, 1.4, 1.4);
      }
      if (s.env.rain) {
        for (let i = 0; i < 3; i++) {
          const rr = R * (0.25 + Math.random() * 0.5);
          pc.fillStyle = `rgba(93,202,165,${Math.random() * 0.22})`;
          pc.fillRect(C + ca * rr, C + sa * rr, 2, 2);
        }
      }
      // Coastline and islands from the public chart
      if (s.env.seabed && s.env.seabed.kind === 'fjord') {
        const v = headingVec(brg);
        for (let i = 4; i < 60; i++) {
          const r = (i / 60) * rangeM;
          if (depthAt(s.env.seabed, s.own.x + v.x * r, s.own.y + v.y * r) < 0) {
            pc.fillStyle = `rgba(150,235,200,${0.35 + Math.random() * 0.35})`;
            pc.fillRect(C + ca * r * scale, C + sa * r * scale, 2.2, 2.2);
            // Radar shadow behind the first land return
            break;
          }
        }
      }
      // Receiver noise
      if (Math.random() < 0.5) {
        const rr = Math.random() * R;
        pc.fillStyle = `rgba(93,202,165,${Math.random() * 0.18})`;
        pc.fillRect(C + ca * rr, C + sa * rr, 1, 1);
      }
    }
    // Contacts painted by this sweep segment
    for (const c of s.contacts) {
      if (!c.sensors.includes('radar') || c.range === undefined || s.time - c.lastSeen > 3) continue;
      if ((c.bearing - prev + 360) % 360 > span) continue;
      const r = c.range * scale;
      if (r > R) continue;
      const a = toRad(c.bearing);
      const x = C + Math.cos(a) * r, y = C + Math.sin(a) * r;
      // A return is an arc smeared by beam width, deeper for bigger ships
      const g = pc.createRadialGradient(x, y, 0, x, y, 7);
      g.addColorStop(0, 'rgba(230,255,240,0.95)');
      g.addColorStop(0.4, 'rgba(120,235,190,0.6)');
      g.addColorStop(1, 'rgba(93,202,165,0)');
      pc.fillStyle = g;
      pc.beginPath(); pc.arc(x, y, 7, 0, TAU); pc.fill();
      pc.strokeStyle = 'rgba(170,250,215,0.7)';
      pc.lineWidth = 2.2;
      pc.beginPath(); pc.arc(C, C, r, a - 0.025, a + 0.025); pc.stroke();
    }
    pc.restore();
  }

  /** Composite the tube, sweep trail, bezel and markings into the station canvas. */
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, s: Snapshot | undefined, rangeNm: number, selected?: string): { ox: number; oy: number; k: number } {
    ctx.fillStyle = '#030807';
    ctx.fillRect(0, 0, w, h);
    const size = Math.min(w, h);
    const ox = (w - size) / 2;
    const oy = (h - size) / 2;
    const k = size / S;
    const cx = ox + C * k, cy = oy + C * k, rr = R * k;
    // Tube glass: dark green radial gradient
    const glass = ctx.createRadialGradient(cx, cy, rr * 0.1, cx, cy, rr * 1.05);
    glass.addColorStop(0, '#06140f');
    glass.addColorStop(1, '#020605');
    ctx.fillStyle = glass;
    ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU); ctx.fill();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(this.phos, ox, oy, size, size);
    ctx.restore();
    const on = !!s?.own.radarOn;
    if (on) {
      // Sweep with a glowing trail
      const a = toRad(this.sweep);
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU); ctx.clip();
      const trail = ctx.createConicGradient(a - 0.6, cx, cy);
      trail.addColorStop(0, 'rgba(93,202,165,0)');
      trail.addColorStop(0.095, 'rgba(93,202,165,0.22)');
      trail.addColorStop(0.0955, 'rgba(93,202,165,0)');
      ctx.fillStyle = trail;
      ctx.fillRect(cx - rr, cy - rr, rr * 2, rr * 2);
      ctx.strokeStyle = 'rgba(190,255,225,0.95)';
      ctx.lineWidth = 1.6;
      ctx.shadowColor = 'rgba(120,240,190,0.9)';
      ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); ctx.stroke();
      ctx.restore();
    }
    // Range rings with labels
    ctx.strokeStyle = 'rgba(93,202,165,0.22)';
    ctx.lineWidth = 1;
    ctx.font = `${Math.max(9, 11 * k)}px ui-monospace, monospace`;
    ctx.fillStyle = 'rgba(159,230,204,0.7)';
    ctx.textAlign = 'left';
    for (let i = 1; i <= 4; i++) {
      ctx.beginPath(); ctx.arc(cx, cy, (rr * i) / 4, 0, TAU); ctx.stroke();
      if (i < 4) ctx.fillText(`${(rangeNm * i) / 4}`, cx + 3, cy - (rr * i) / 4 + 11);
    }
    ctx.beginPath(); ctx.moveTo(cx - rr, cy); ctx.lineTo(cx + rr, cy); ctx.moveTo(cx, cy - rr); ctx.lineTo(cx, cy + rr); ctx.stroke();
    // Bezel: bearing ring with 5° ticks, numerals every 30°
    ctx.strokeStyle = 'rgba(93,202,165,0.75)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, rr + 1, 0, TAU); ctx.stroke();
    ctx.lineWidth = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let d = 0; d < 360; d += 5) {
      const a = toRad(d);
      const len = d % 30 === 0 ? 10 : d % 10 === 0 ? 6 : 3;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (rr + 2), cy + Math.sin(a) * (rr + 2));
      ctx.lineTo(cx + Math.cos(a) * (rr + 2 + len * k * 1.2), cy + Math.sin(a) * (rr + 2 + len * k * 1.2));
      ctx.stroke();
      if (d % 30 === 0) ctx.fillText(String(d).padStart(3, '0'), cx + Math.cos(a) * (rr + 22 * k + 6), cy + Math.sin(a) * (rr + 22 * k + 6));
    }
    ctx.textBaseline = 'alphabetic';
    if (s) {
      // Ship's-head marker
      const hm = toRad(s.own.heading);
      ctx.strokeStyle = 'rgba(232,195,122,0.8)';
      ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(hm) * rr, cy + Math.sin(hm) * rr); ctx.stroke();
      ctx.setLineDash([]);
      // ESM strobes: bearing lines of intercepted emitters
      for (const c of s.contacts) {
        if (!c.sensors.includes('esm') || s.time - c.lastSeen > 300) continue;
        const a = toRad(c.bearing);
        ctx.strokeStyle = `rgba(240,149,149,${0.75 - (s.time - c.lastSeen) / 500})`;
        ctx.setLineDash([6, 4]);
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); ctx.stroke();
        ctx.setLineDash([]);
      }
      // Air: radar tracks inside the scale, ESM strobes of aircraft radars
      const scale = rr / (rangeNm * 1852);
      drawAir(ctx, s, (x, y) => {
        const dx = (x - s.own.x) * scale;
        const dy = (y - s.own.y) * scale;
        return Math.hypot(dx, dy) < rr ? { x: cx + dx, y: cy - dy } : undefined;
      }, { x: cx, y: cy }, rr, (p) => (on && p.via.includes('radar')) || p.via.includes('esm'));
      // Selected radar contact: amber brackets
      const sel = s.contacts.find((c) => c.label === selected && c.sensors.includes('radar') && c.range !== undefined);
      if (sel && on) {
        const r = (sel.range! / (rangeNm * 1852)) * rr;
        if (r < rr) {
          const a = toRad(sel.bearing);
          const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
          ctx.strokeStyle = '#e8c37a';
          ctx.strokeRect(x - 9, y - 9, 18, 18);
          ctx.fillStyle = '#e8c37a';
          ctx.textAlign = 'left';
          ctx.fillText(sel.label, x + 12, y - 8);
        }
      }
    }
    if (!on) {
      ctx.fillStyle = 'rgba(232,195,122,0.85)';
      ctx.textAlign = 'center';
      ctx.font = `${Math.max(11, 14 * k)}px ui-monospace, monospace`;
      ctx.fillText('STANDBY · SENDER AUS', cx, cy - 8);
      ctx.fillStyle = 'rgba(159,230,204,0.6)';
      ctx.font = `${Math.max(9, 11 * k)}px ui-monospace, monospace`;
      ctx.fillText('ESM HÖRT WEITER MIT', cx, cy + 12);
    }
    // Tube vignette
    const vig = ctx.createRadialGradient(cx, cy, rr * 0.7, cx, cy, rr);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = vig;
    ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU); ctx.fill();
    return { ox, oy, k };
  }
}

export const SCOPE = { S, C, R };
