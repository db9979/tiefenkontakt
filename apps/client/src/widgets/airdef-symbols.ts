import type { Snapshot } from '@tk/shared';

/**
 * Plot symbols for air defence and mines: a missile's track from the launcher with a
 * flame head (burst star on a kill, ring on a miss), and naval mines (ball with horns:
 * own mines amber, enemy mines found by sonar red).
 */

type ToScreen = (x: number, y: number) => { x: number; y: number } | undefined;

export function drawMissiles(ctx: CanvasRenderingContext2D, s: Snapshot, toScreen: ToScreen): void {
  const list = s.airdef?.missiles ?? [];
  if (!list.length) return;
  ctx.save();
  ctx.font = '10px ui-monospace, monospace';
  for (const m of list) {
    const p = toScreen(m.x, m.y);
    if (!p) continue;
    const a = toScreen(m.fromX, m.fromY);
    const col = m.done === 'miss' ? '#9aa4a8' : '#f4d08a';
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    if (a) {
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (m.done === 'hit') {
      ctx.strokeStyle = '#ff8a3a';
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const r = i % 2 ? 4 : 9;
        const ang = (i * Math.PI) / 4;
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + Math.cos(ang) * r, p.y + Math.sin(ang) * r);
      }
      ctx.stroke();
      ctx.fillStyle = '#ff8a3a';
      ctx.fillText('ABSCHUSS', p.x + 10, p.y + 4);
    } else if (m.done === 'miss') {
      ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, 7); ctx.stroke();
      ctx.fillText('FEHL', p.x + 7, p.y + 4);
    } else {
      // Head: a small dart along the flight direction
      const h = ((m.heading - 90) * Math.PI) / 180;
      ctx.beginPath();
      ctx.moveTo(p.x + Math.cos(h) * 6, p.y + Math.sin(h) * 6);
      ctx.lineTo(p.x + Math.cos(h + 2.5) * 4, p.y + Math.sin(h + 2.5) * 4);
      ctx.lineTo(p.x + Math.cos(h - 2.5) * 4, p.y + Math.sin(h - 2.5) * 4);
      ctx.closePath();
      ctx.fill();
      ctx.fillText(`FK ${m.id}`, p.x + 7, p.y - 5);
    }
  }
  ctx.restore();
}

/** Anti-ship missiles: red darts for incoming rounds, amber for own side; burst on a hit, ring when shot down. */
export function drawSsm(ctx: CanvasRenderingContext2D, s: Snapshot, toScreen: ToScreen): void {
  const list = s.ssm?.missiles ?? [];
  if (!list.length) return;
  ctx.save();
  ctx.font = '10px ui-monospace, monospace';
  for (const m of list) {
    const p = toScreen(m.x, m.y);
    if (!p) continue;
    const col = m.done ? '#9aa4a8' : m.team ? '#f4d08a' : '#ff5a4a';
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    if (m.done) {
      ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, 7); ctx.stroke();
      ctx.fillText(m.done === 'hit' ? 'TREFFER' : m.done === 'shot' ? 'ABGEWEHRT' : 'FEHL', p.x + 7, p.y + 4);
      continue;
    }
    const h = ((m.heading - 90) * Math.PI) / 180;
    ctx.beginPath();
    ctx.moveTo(p.x - Math.cos(h) * 14, p.y - Math.sin(h) * 14); ctx.lineTo(p.x, p.y); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(p.x + Math.cos(h) * 7, p.y + Math.sin(h) * 7);
    ctx.lineTo(p.x + Math.cos(h + 2.5) * 4, p.y + Math.sin(h + 2.5) * 4);
    ctx.lineTo(p.x + Math.cos(h - 2.5) * 4, p.y + Math.sin(h - 2.5) * 4);
    ctx.closePath();
    ctx.fill();
    ctx.fillText(`SSM ${m.id}`, p.x + 8, p.y - 5);
  }
  ctx.restore();
}

export function drawMines(ctx: CanvasRenderingContext2D, s: Snapshot, toScreen: ToScreen): void {
  const list = s.mines ?? [];
  if (!list.length) return;
  ctx.save();
  ctx.font = '10px ui-monospace, monospace';
  ctx.lineWidth = 1.3;
  for (const m of list) {
    const p = toScreen(m.x, m.y);
    if (!p) continue;
    const col = m.own ? (m.armed ? '#fac775' : 'rgba(250,199,117,0.55)') : '#f09595';
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, 7); ctx.stroke();
    // Horns
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const ang = Math.PI / 4 + (i * Math.PI) / 2;
      ctx.moveTo(p.x + Math.cos(ang) * 4, p.y + Math.sin(ang) * 4);
      ctx.lineTo(p.x + Math.cos(ang) * 7, p.y + Math.sin(ang) * 7);
    }
    ctx.stroke();
    if (m.bottom) {
      ctx.beginPath(); ctx.moveTo(p.x - 6, p.y + 8); ctx.lineTo(p.x + 6, p.y + 8); ctx.stroke();
    }
    ctx.fillText(`MINE ${m.id}${m.own && !m.armed ? ' · SCHARF IN KÜRZE' : ''}`, p.x + 9, p.y - 5);
  }
  ctx.restore();
}

/** Search sector of the mine-avoidance sonar ahead of the own ship (±70°, its current range). */
export function drawMineSector(ctx: CanvasRenderingContext2D, s: Snapshot, me: { x: number; y: number }, scale: number): void {
  const r = s.own.mineAvoidRange;
  if (!s.own.mineAvoid || !r) return;
  const px = r / scale;
  const a0 = ((s.own.heading - 70 - 90) * Math.PI) / 180;
  const a1 = ((s.own.heading + 70 - 90) * Math.PI) / 180;
  ctx.save();
  ctx.strokeStyle = 'rgba(159,225,203,0.55)';
  ctx.fillStyle = 'rgba(159,225,203,0.06)';
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(me.x, me.y);
  ctx.arc(me.x, me.y, px, a0, a1);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
