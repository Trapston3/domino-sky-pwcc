import type { SimulatedFlight } from '../engine/types.js';

export type CanvasTheme = 'night' | 'day';

export interface ThemePalette {
  readonly bg: string;
  readonly bgCenter: string;
  readonly landDot: string;
  readonly landFill: string;
  readonly border: string;
  readonly grid: string;
  readonly ink: string;
  readonly muted: string;
  readonly panel: string;
  readonly panelBorder: string;
  readonly onTime: string;
  readonly minorDelay: string;
  readonly majorBreach: string;
  readonly spare: string;
  readonly storm: string;
  readonly shadow: string;
  readonly routeBase: string;
  readonly trailBlend: GlobalCompositeOperation;
}

export const NIGHT_PALETTE: ThemePalette = {
  bg: '#0B0A12',
  bgCenter: '#131022',
  landDot: '#2C2840',
  landFill: 'rgba(44, 40, 64, 0.24)',
  border: '#423B60',
  grid: 'rgba(150, 144, 168, 0.06)',
  ink: '#F4ECDC',
  muted: '#9690A8',
  panel: '#14121EEB',
  panelBorder: '#2A2638',
  onTime: '#FFE9B8',
  minorDelay: '#FF9F1C',
  majorBreach: '#FF4D3A',
  spare: '#7AD7C1',
  storm: '#B9A8FF',
  shadow: 'rgba(4, 3, 10, 0.62)',
  routeBase: 'rgba(150, 144, 168, 0.14)',
  trailBlend: 'lighter',
};

export const DAY_PALETTE: ThemePalette = {
  bg: '#ECE6D8',
  bgCenter: '#F4EFE4',
  landDot: '#C4B99F',
  landFill: 'rgba(196, 185, 159, 0.28)',
  border: '#A4987E',
  grid: 'rgba(82, 76, 97, 0.08)',
  ink: '#1A1724',
  muted: '#524C61',
  panel: '#F6F2E8EB',
  panelBorder: '#C4B99F',
  onTime: '#2F6B4F',
  minorDelay: '#C98A0B',
  majorBreach: '#C8341C',
  spare: '#1D4E89',
  storm: '#6B4FC8',
  shadow: 'rgba(26, 23, 36, 0.18)',
  routeBase: 'rgba(82, 76, 97, 0.16)',
  trailBlend: 'source-over',
};

/**
 * Returns the palette matching SPEC §5 hex colors for Night or Day mode.
 */
export function getCanvasPalette(theme: CanvasTheme): ThemePalette {
  return theme === 'night' ? NIGHT_PALETTE : DAY_PALETTE;
}

/**
 * Resolves the live status color for a simulated flight.
 */
export function getFlightStatusColor(
  flight: SimulatedFlight,
  palette: ThemePalette,
  forceSpare = false
): string {
  if (forceSpare || flight.status === 'recovered') return palette.spare;
  if (flight.crewBreachLeg || flight.status === 'major_delay') return palette.majorBreach;
  if (flight.status === 'minor_delay') return palette.minorDelay;
  if (flight.status === 'cancelled') return palette.muted;
  return palette.onTime;
}

/**
 * Tests rectangle overlap against pre-allocated Float32Array [x0, y0, x1, y1] buffer.
 */
export function hasRectOverlap(
  rects: Float32Array,
  count: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): boolean {
  for (let i = 0; i < count; i++) {
    const off = i * 4;
    if (
      x0 < rects[off + 2] &&
      x1 > rects[off] &&
      y0 < rects[off + 3] &&
      y1 > rects[off + 1]
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Records a bounding rect into the pre-allocated declutter buffer if space remains.
 */
export function pushRect(
  rects: Float32Array,
  count: number,
  maxCount: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): number {
  if (count >= maxCount) return count;
  const off = count * 4;
  rects[off] = x0;
  rects[off + 1] = y0;
  rects[off + 2] = x1;
  rects[off + 3] = y1;
  return count + 1;
}

/**
 * Draws an upright rounded badge pill centered horizontally at `cx` and vertically at `cy`.
 */
export function drawUprightPill(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  bgColor: string,
  borderColor: string,
  textColor: string,
  paddingX = 8,
  height = 20
): { x0: number; y0: number; x1: number; y1: number } {
  const width = ctx.measureText(text).width + paddingX * 2;
  const x0 = cx - width * 0.5;
  const y0 = cy - height * 0.5;
  const r = 5;

  ctx.beginPath();
  ctx.roundRect(x0, y0, width, height, r);
  ctx.fillStyle = bgColor;
  ctx.fill();
  ctx.lineWidth = 1.25;
  ctx.strokeStyle = borderColor;
  ctx.stroke();

  ctx.fillStyle = textColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, cy + 0.5);

  return { x0, y0, x1: x0 + width, y1: y0 + height };
}
