import { CLASSES, bearing, canCopy, distance, mastRaised, type GameEvent, type Ship, type World, trueDeg3 } from '@tk/shared';
import type { AlertContext } from './match-events.js';

/** Alerts for air defence (missiles, interceptors) and naval mines, for both sides. */

/** A boat that can copy fleet command right now (buoy/wire antenna, mast, surfaced). */
function hearsCommand(s: Ship): boolean {
  return !!(canCopy(s) || mastRaised(s) || s.depth <= 0.5);
}

export function airdefAlerts(w: World, fresh: GameEvent[], ctx: AlertContext): void {
  const each = (pick: (own: Ship) => boolean, make: (own: Ship) => Parameters<AlertContext['alert']>[1] | undefined) => {
    for (const s of ctx.slots) {
      const own = ctx.shipOf(s.playerId);
      if (!own?.alive || !pick(own)) continue;
      const a = make(own);
      if (a) ctx.alert(s.playerId, a);
    }
  };
  const surface = (team: string) => (own: Ship) => own.team === team && !CLASSES[own.cls].submarine;
  const boats = (team: string) => (own: Ship) => own.team !== team && CLASSES[own.cls].submarine && hearsCommand(own);
  const lost = (e: { time: number }) => () => ({ time: e.time, kind: 'command' as const, text: 'FÜHRUNG · VERBINDUNG ZUM AUFKLÄRER ABGERISSEN · VERMUTLICH ABGESCHOSSEN' });
  for (const e of fresh) {
    if (e.kind === 'weapon' && e.what === 'ssm') {
      const shooter = w.ships.find((s) => s.id === e.sourceId);
      if (!shooter) continue;
      each((own) => own.id === shooter.id, () => ({ time: e.time, kind: 'boat', text: 'SEEZIELFLUGKÖRPER AB · STARTER LÄDT NACH' }));
      // Escorts see the launch flash on radar (or by eye close in): the raid warning
      each((own) => own.team !== shooter.team && own.team !== 'neutral' && !CLASSES[own.cls].submarine && distance(own.pos, shooter.pos) < (own.radarOn ? 30_000 : 9000),
        (own) => ({ time: e.time, kind: 'boat', bearing: bearing(own.pos, shooter.pos), text: `FLUGKÖRPERWARNUNG · SEEZIELFLUGKÖRPER STARTET PEILUNG ${trueDeg3(w, bearing(own.pos, shooter.pos))}°${own.radarOn ? '' : ' · RADAR AN FÜR ABWEHR'}` }));
    } else if (e.kind === 'airdef') {
      const shooter = e.shipId ? w.ships.find((s) => s.id === e.shipId) : undefined;
      if (e.what === 'launch' && shooter) {
        each((own) => own.id === shooter.id, (own) => ({ time: e.time, kind: 'boat', bearing: bearing(own.pos, e), text: `FLUGABWEHR · FLUGKÖRPER ABGEFEUERT · ZIEL PEILUNG ${trueDeg3(w, bearing(own.pos, e))}°` }));
        // Boats with an optic up may see the smoke trail climb
        const reach = (w.env.light ?? 1) > 0.4 ? 25_000 : 35_000;
        each((own) => own.team !== shooter.team && CLASSES[own.cls].submarine && mastRaised(own) && distance(own.pos, shooter.pos) < reach * (w.env.rain ? 0.4 : 1),
          (own) => ({ time: e.time, kind: 'boat', bearing: bearing(own.pos, shooter.pos), text: `AUSGUCK · RAKETENSTART PEILUNG ${trueDeg3(w, bearing(own.pos, shooter.pos))}° · FLUGABWEHR` }));
      } else if (e.what === 'kill') {
        each(surface(e.team), () => ({ time: e.time, kind: 'boat', text: `FLUGABWEHR · ZIEL ABGESCHOSSEN${shooter ? ` · ${shooter.name}` : ''}` }));
        each(boats(e.team), lost(e));
      } else if (e.what === 'miss') {
        each((own) => own.id === e.shipId, () => ({ time: e.time, kind: 'boat', text: 'FLUGABWEHR · ZIEL VERFEHLT' }));
      } else if (e.what === 'fighter_out') {
        each(surface(e.team), () => ({ time: e.time, kind: 'boat', text: `ABFANGJÄGER ANGEFORDERT${shooter ? ` VON ${shooter.name}` : ''} · ANKUNFT IN CA. 12 MIN` }));
      } else if (e.what === 'fighter_kill') {
        each(surface(e.team), () => ({ time: e.time, kind: 'boat', text: 'ABFANGJÄGER MELDET: AUFKLÄRER ABGESCHOSSEN' }));
        each(boats(e.team), lost(e));
      } else if (e.what === 'fighter_none') {
        each(surface(e.team), () => ({ time: e.time, kind: 'boat', text: 'ABFANGJÄGER: KEIN ZIEL GEFUNDEN · RÜCKFLUG' }));
      }
    } else if (e.kind === 'mine') {
      if (e.what === 'detected') {
        each(surface(e.team), (own) => {
          const b = bearing(own.pos, e);
          return { time: e.time, kind: 'boat', bearing: b, text: `MINENWARNUNG · MINE PEILUNG ${trueDeg3(w, b)}° · ${Math.round(distance(own.pos, e) / 10) * 10} M` };
        });
      } else {
        each((own) => own.id === e.shipId, () => ({ time: e.time, kind: 'sunk', text: 'MINENTREFFER · WASSEREINBRUCH' }));
      }
    }
  }
}
