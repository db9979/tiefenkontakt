import { depthAt, type MissionKey, type SeabedKind } from '@tk/shared';
import { esc } from './format.js';

interface Card { key: MissionKey; title: string; info: string; seabed: SeabedKind; kind: 'convoy' | 'duel' | 'harbour' }

const CARDS: Card[] = [
  { key: 'groenland', title: 'Grönland-Lücke', info: 'Tiefwasser · Konvergenzzonen', seabed: 'tief', kind: 'convoy' },
  { key: 'schelf', title: 'Schelfmeer', info: 'Flach · Nachhall', seabed: 'schelf', kind: 'convoy' },
  { key: 'fjord', title: 'Fjordausfahrt', info: 'Enger Kanal', seabed: 'fjord', kind: 'convoy' },
  { key: 'duell', title: 'U-Boot-Duell', info: 'Boot gegen Boot', seabed: 'tief', kind: 'duel' },
  { key: 'hafen', title: 'Hafenangriff', info: 'Ankerplatz in der Bucht', seabed: 'fjord', kind: 'harbour' },
  { key: 'eigene', title: 'Eigene Mission', info: 'Frei einstellbar', seabed: 'tief', kind: 'convoy' },
];

/** Mission picker: cards with a small chart of the sea area and the convoy route. */
export function missionCards(current: MissionKey): string {
  return `<div class="mcards">${CARDS.map((c) => `<button class="mcard ${c.key === current ? 'on' : ''}" data-mission="${c.key}">
    <canvas data-chart="${c.key}" width="150" height="84"></canvas>
    <div class="mcard-t">${esc(c.title)}</div><div class="dim">${esc(c.info)}</div></button>`).join('')}</div>`;
}

const charts = new Map<string, ImageData>();

/** Draw the chart canvases rendered by missionCards (cached per mission). */
export function paintMissionCharts(root: HTMLElement, customSeabed?: SeabedKind): void {
  root.querySelectorAll<HTMLCanvasElement>('canvas[data-chart]').forEach((cv) => {
    const card = CARDS.find((c) => c.key === cv.dataset.chart)!;
    const seabed = card.key === 'eigene' && customSeabed ? customSeabed : card.seabed;
    const ctx = cv.getContext('2d')!;
    const key = `${card.key}|${seabed}`;
    let img = charts.get(key);
    if (!img) {
      img = ctx.createImageData(cv.width, cv.height);
      const spec = { kind: seabed, seed: 7 };
      for (let j = 0; j < cv.height; j++) {
        for (let i = 0; i < cv.width; i++) {
          // 60 × 34 km around the route; north up
          const d = depthAt(spec, (i / cv.width - 0.5) * 60_000, (1 - j / cv.height) * 34_000 - 4_000);
          const [r, g, b] = d < 0 ? [70, 66, 48] : d < 60 ? [60, 82, 70] : d < 300 ? [20, 52, 54] : d < 2000 ? [12, 34, 40] : [8, 22, 28];
          const k = (j * cv.width + i) * 4;
          img.data.set([r, g, b, 255], k);
        }
      }
      charts.set(key, img);
    }
    ctx.putImageData(img, 0, 0);
    const W = cv.width;
    const H = cv.height;
    ctx.lineWidth = 1.5;
    if (card.kind === 'convoy') {
      ctx.strokeStyle = '#85b7eb';
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(W / 2, H - 6); ctx.lineTo(W / 2, 10); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#85b7eb';
      ctx.beginPath(); ctx.moveTo(W / 2, 4); ctx.lineTo(W / 2 - 5, 12); ctx.lineTo(W / 2 + 5, 12); ctx.fill();
      for (const x of [-1, 0, 1]) ctx.fillRect(W / 2 + x * 6 - 1.5, H - 14, 3, 6);
    }
    if (card.kind === 'harbour') {
      ctx.fillStyle = '#85b7eb';
      for (let i = 0; i < 6; i++) ctx.fillRect(W / 2 - 14 + (i % 3) * 12, 18 + Math.floor(i / 3) * 8, 3, 5);
    }
    ctx.strokeStyle = '#f09595';
    const subs = card.kind === 'duel' ? [[W * 0.5, 14]] : card.kind === 'harbour' ? [[W * 0.4, H - 16], [W * 0.6, H - 20]] : [[W * 0.35, H * 0.45], [W * 0.62, H * 0.4]];
    for (const [x, y] of subs) {
      ctx.beginPath(); ctx.moveTo(x! - 6, y! - 2); ctx.lineTo(x!, y! + 5); ctx.lineTo(x! + 6, y! - 2); ctx.stroke();
    }
    if (card.kind === 'duel') {
      ctx.strokeStyle = '#85b7eb';
      ctx.beginPath(); ctx.arc(W / 2, H - 14, 5, Math.PI, 0, true); ctx.stroke();
    }
  });
}
