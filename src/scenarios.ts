import { parseTimeMin } from './engine/index.js';
import type { ClosureSpec } from './engine/types.js';

export interface ScenarioPreset {
  id: string;
  label: string;
  shortLabel: string;
  description: string;
  closure: ClosureSpec | null;
}

export const DURATION_OPTIONS = [30, 60, 90, 120, 180] as const;
export type DurationOption = (typeof DURATION_OPTIONS)[number];

export const SCENARIO_PRESETS: readonly ScenarioPreset[] = [
  {
    id: 'mumbai-storm',
    label: 'Mumbai storm',
    shortLabel: 'BOM 07:30–09:00',
    description: 'Morning monsoon squall closes Mumbai (BOM) from 07:30 to 09:00 IST.',
    closure: { airport: 'BOM', start: '07:30', end: '09:00' },
  },
  {
    id: 'delhi-squall',
    label: 'Delhi squall',
    shortLabel: 'DEL 12:00–13:30',
    description: 'Midday convective squall closes Delhi (DEL) from 12:00 to 13:30 IST.',
    closure: { airport: 'DEL', start: '12:00', end: '13:30' },
  },
  {
    id: 'bengaluru-stop',
    label: 'Bengaluru ground stop',
    shortLabel: 'BLR 13:00–14:30',
    description: 'Afternoon ATC ground stop closes Bengaluru (BLR) from 13:00 to 14:30 IST.',
    closure: { airport: 'BLR', start: '13:00', end: '14:30' },
  },
  {
    id: 'kolkata-evening',
    label: 'Kolkata evening',
    shortLabel: 'CCU 16:00–17:30',
    description: 'Evening storm closes Kolkata (CCU) from 16:00 to 17:30 IST.',
    closure: { airport: 'CCU', start: '16:00', end: '17:30' },
  },
  {
    id: 'clear-skies',
    label: 'Clear skies',
    shortLabel: 'Nominal',
    description: 'Nominal operations across the network with no airport closure.',
    closure: null,
  },
];

export const DEFAULT_SCENARIO = SCENARIO_PRESETS[0];

export function closuresEqual(a: ClosureSpec | null, b: ClosureSpec | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.airport === b.airport && a.start === b.start && a.end === b.end;
}

export function findMatchingPreset(closure: ClosureSpec | null): ScenarioPreset | null {
  return SCENARIO_PRESETS.find((preset) => closuresEqual(preset.closure, closure)) ?? null;
}

export function getClosureDurationMin(closure: ClosureSpec | null): number | null {
  if (!closure) return null;
  const diff = parseTimeMin(closure.end) - parseTimeMin(closure.start);
  return diff > 0 ? diff : null;
}
