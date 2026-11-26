/**
 * The English dictionaries in one chunk of their own: German players never download them
 * (index.ts loads this before the first screen when the language is English).
 */
import { EN_HELP, EN_PHRASES } from './en-help.js';
import { EN_CANVAS, EN_MORE, EN_MORE_PHRASES } from './en-more.js';
import { EN_UI } from './en-ui.js';
import { EN_UX, EN_UX_PHRASES } from './en-ux.js';
import { EN_DAMAGE_PHRASES } from './en-damage.js';
import { EN_TUTORIAL } from './en-tutorial.js';
import { EN_RANKS, EN_RANKS_PHRASES } from './en-ranks.js';
import { EN_RANGE, EN_RANGE_PHRASES } from './en-range.js';
import { EN_RECOG, EN_RECOG_PHRASES } from './en-recog.js';
import { EN_WEAPONS, EN_WEAPONS_PHRASES } from './en-weapons.js';
import { EN_PACING, EN_PACING_PHRASES } from './en-pacing.js';
import { EN_HELO, EN_HELO_PHRASES } from './en-helo.js';
import { EN_STATIONS, EN_STATIONS_PHRASES } from './en-stations.js';
import { EN_ESCORT, EN_ESCORT_PHRASES } from './en-escort.js';
import { EN_WIDGETS, EN_WIDGETS_PHRASES } from './en-widgets.js';

export const dict = new Map<string, string>([...EN_STATIONS, ...EN_RECOG, ...EN_UI, ...EN_HELP, ...EN_MORE, ...EN_UX, ...EN_TUTORIAL, ...EN_RANKS, ...EN_RANGE, ...EN_WEAPONS, ...EN_PACING, ...EN_HELO, ...EN_ESCORT, ...EN_WIDGETS]);
export const canvasDict = new Map<string, string>(EN_CANVAS);
export const PHRASES = [...EN_WIDGETS_PHRASES, ...EN_STATIONS_PHRASES, ...EN_ESCORT_PHRASES, ...EN_HELO_PHRASES, ...EN_WEAPONS_PHRASES, ...EN_PACING_PHRASES, ...EN_RECOG_PHRASES, ...EN_RANGE_PHRASES, ...EN_RANKS_PHRASES, ...EN_DAMAGE_PHRASES, ...EN_UX_PHRASES, ...EN_PHRASES, ...EN_MORE_PHRASES];
