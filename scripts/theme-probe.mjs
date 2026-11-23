/**
 * Page-side probes for scripts/theme-check.mjs: a contrast measurement of all visible text and a
 * small synthetic debrief (a convoy, an escort and a boat over twenty minutes).
 */

/**
 * Source of a page function: every visible element with its own text, its colour against the
 * first opaque background behind it (a gradient counts with its last colour stop), and the
 * WCAG contrast ratio. Returns the texts below `min`. Canvases are drawn, not checked.
 */
export const CONTRAST = `(min) => {
  const parse = (c) => {
    const m = c && c.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const [r, g, b, a = 1] = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number);
    return [r, g, b, a];
  };
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const mix = (top, under) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1);
  const bgOf = (el) => {
    const layers = [];
    for (let e = el; e; e = e.parentElement) {
      const s = getComputedStyle(e);
      const img = s.backgroundImage;
      if (img && img.includes('gradient')) {
        const stops = img.match(/rgba?\\([^)]+\\)/g);
        const last = stops && parse(stops[stops.length - 1]);
        if (last && last[3] > 0.5) { layers.push(last); break; }
      }
      const c = parse(s.backgroundColor);
      if (c && c[3] > 0) { layers.push(c); if (c[3] >= 0.95) break; }
    }
    let bg = parse(getComputedStyle(document.body).backgroundColor) || [0, 0, 0, 1];
    for (const l of layers.reverse()) bg = mix(l, bg);
    return bg;
  };
  const out = [];
  const seen = new Set();
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('canvas, svg, script, style, option, :disabled')) continue;
    const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent.trim()).join(' ');
    if (!own) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none') continue;
    let op = 1;
    for (let e = el; e; e = e.parentElement) op *= Number(getComputedStyle(e).opacity);
    if (op < 0.2) continue;
    const bg = bgOf(el);
    let fg = parse(s.color);
    if (!fg) continue;
    fg = mix([fg[0], fg[1], fg[2], fg[3] * op], bg);
    const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
    const ratio = (a + 0.05) / (b + 0.05);
    if (ratio >= min) continue;
    const sel = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + [...el.classList].map((c) => '.' + c).join('');
    const key = sel + own.slice(0, 20);
    if (seen.has(key)) continue;
    seen.add(key);
    const hex = (c) => '#' + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
    out.push({ sel, text: own.slice(0, 40), ratio, fg: hex(fg), bg: hex(bg) });
  }
  return out;
}`;

/** A synthetic finished match as a JSON literal for the debrief overlay. */
export function fakeDebrief() {
  const ships = [
    { id: 'p_w', name: 'Kommodore', cls: 'ffg', team: 'west', player: true },
    { id: 'p_e', name: 'Kaleun', cls: 'ssk', team: 'east', player: true },
    ...[1, 2, 3, 4].map((i) => ({ id: `m${i}`, name: `Frachter ${i}`, cls: 'merchant', team: 'west', player: false })),
  ];
  const frames = [];
  for (let t = 0; t <= 1200; t += 20) {
    const y = t * 4.6;
    frames.push([t, [
      ['p_w', 2500 + Math.sin(t / 200) * 800, y + 2500, 0, 1],
      ['p_e', -3000 + t * 1.5, 14_000 - t * 0.5, 120, t < 1100 ? 1 : 0],
      ...[1, 2, 3, 4].map((i) => [`m${i}`, ((i % 2) - 0.5) * 1800, y - Math.floor(i / 3) * 900, 0, i === 2 && t > 900 ? 0 : 1]),
    ]]);
  }
  const stat = (id, callsign, team, cls, won, extra) => ({
    playerId: id, callsign, team, cls, survived: won, shots: 2, rockets: 1, buoys: 3, kills: won ? 1 : 0, tonnageSunk: team === 'east' ? 7200 : 0,
    firstContactS: 300, distanceNm: 6.4, won, ...extra,
  });
  return JSON.stringify({
    ships, frames, torpedoes: [[880, [['t1', -1500, 4200]]], [900, [['t1', -400, 4100]]]],
    events: [{ t: 900, kind: 'sunk', shipId: 'm2', byId: 'p_e', what: 'Torpedo' }, { t: 1100, kind: 'sunk', shipId: 'p_e', byId: 'p_w', what: 'U-Jagd-Rakete' }],
    stats: [stat('w', 'Kommodore', 'west', 'ffg', true), stat('e', 'Kaleun', 'east', 'ssk', false)],
    winner: 'west', reason: 'Alle U-Boote versenkt', duration: 1200,
    learned: ['Der Gegner taucht öfter unter die Sprungschicht.'],
    setup: { seed: 4242, settings: { mission: 'groenland', timeOfDay: 'tag', weather: 'wechselhaft', seaState: 3, timeLimitMin: 40, merchants: 8, fillBots: true, botSkill: 'normal', variation: 'leicht' } },
  });
}
