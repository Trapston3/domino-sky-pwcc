const HHMM_REGEX = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

/**
 * Returns true if the string is a valid 24-hour HH:MM timestamp (00:00-23:59).
 */
export function isValidHHMM(value: string): boolean {
  return HHMM_REGEX.test(value);
}

/**
 * Parses a 24-hour HH:MM string into integer minutes from 00:00.
 */
export function parseTimeMin(hhmm: string): number {
  if (!isValidHHMM(hhmm)) {
    throw new Error(`Invalid HH:MM time: "${hhmm}"`);
  }
  const [hoursStr, minsStr] = hhmm.split(':');
  return Number(hoursStr) * 60 + Number(minsStr);
}

/**
 * Formats integer minutes from 00:00 into HH:MM, appending (+N) past 24:00.
 */
export function formatTimeMin(totalMinutes: number): string {
  const rounded = Math.round(totalMinutes);
  const dayOffset = Math.floor(rounded / 1440);
  const minsInDay = ((rounded % 1440) + 1440) % 1440;
  const hours = Math.floor(minsInDay / 60);
  const mins = minsInDay % 60;
  const hhmm = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  if (dayOffset >= 1) {
    return `${hhmm} (+${dayOffset})`;
  }
  return hhmm;
}
