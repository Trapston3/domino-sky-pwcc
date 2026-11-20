import type { SimulationResult } from '../engine/types.js';
import { MAX_LABEL_RECTS, type SceneBuffers } from './arcBuffers.js';
import { pushRect, type ThemePalette } from './palettes.js';
import type { MapCamera } from './projection.js';

export interface RenderParams {
  width: number;
  height: number;
  theme: 'night' | 'day';
  currentTimeMin: number;
  pulseTimeSec: number;
  reducedMotion: boolean;
  isPreviewActive: boolean;
  selectedFlightId: string | null;
  selectedAirportId: string | null;
  hoveredFlightId: string | null;
  hoveredAirportId: string | null;
}

const FONT_MONO_BADGE = '600 10.5px "IBM Plex Mono", ui-monospace, monospace';

/**
 * Draws an upright rounded badge pill and optionally reserves its rect in the declutter buffer.
 */
export function drawPillZeroAlloc(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  bgColor: string,
  borderColor: string,
  textColor: string,
  buffers: SceneBuffers | null,
  paddingX = 8,
  height = 20
): void {
  const width = ctx.measureText(text).width + paddingX * 2;
  const x0 = cx - width * 0.5;
  const y0 = cy - height * 0.5;

  ctx.beginPath();
  ctx.roundRect(x0, y0, width, height, 5);
  ctx.fillStyle = bgColor;
  ctx.fill();
  ctx.lineWidth = 1.25;
  ctx.strokeStyle = borderColor;
  ctx.stroke();

  ctx.fillStyle = textColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, cy + 0.5);

  if (buffers) {
    buffers.placedLabelCount = pushRect(
      buffers.placedLabelRects,
      buffers.placedLabelCount,
      MAX_LABEL_RECTS,
      x0 - 3,
      y0 - 3,
      x0 + width + 3,
      y0 + height + 3
    );
  }
}

/**
 * Draws airports sized by capacity, storm warning/closure rings, and held-flight queue halos.
 */
export function drawAirportsAndStormLayer(
  ctx: CanvasRenderingContext2D,
  camera: MapCamera,
  buffers: SceneBuffers,
  simulation: SimulationResult,
  palette: ThemePalette,
  params: RenderParams
): void {
  const dataset = buffers.dataset;
  if (!dataset) return;
  const { currentTimeMin, pulseTimeSec, reducedMotion, selectedAirportId, hoveredAirportId } = params;

  buffers.airportHeldCount.fill(0);
  for (let i = 0; i < buffers.flightCount; i++) {
    const f = buffers.activeFlightsOrdered[i];
    if (!f.cancelled && currentTimeMin >= f.schedDepMin && currentTimeMin < f.actualDepMin) {
      const oIdx = buffers.flightOriginIdx[i];
      if (oIdx >= 0) {
        buffers.airportHeldCount[oIdx] += 1;
      }
    }
  }

  const closure = simulation.closure;

  for (let i = 0; i < buffers.airportCount; i++) {
    const airport = dataset.airports[i];
    camera.project(airport.lat, airport.lng, 0, buffers.scratchPt);
    const ax = buffers.scratchPt.x;
    const ay = buffers.scratchPt.y;
    const sc = buffers.scratchPt.scale;

    buffers.airportX[i] = ax;
    buffers.airportY[i] = ay;
    buffers.airportScale[i] = sc;
    buffers.airportDepth[i] = buffers.scratchPt.depth;
    if (!buffers.scratchPt.visible) continue;

    const baseR = (3.2 + (airport.capacity_per_hour / 40) * 4.5) * sc;
    const isClosedTarget = closure !== null && closure.airport === airport.id;
    const isSelected = selectedAirportId === airport.id;
    const isHovered = hoveredAirportId === airport.id;
    const heldCount = buffers.airportHeldCount[i];

    if (airport.tier !== 'spoke' || isClosedTarget || isSelected) {
      ctx.save();
      ctx.globalCompositeOperation = palette.trailBlend;
      const glowR = baseR * (isClosedTarget ? 4.0 : 2.6);
      const glow = ctx.createRadialGradient(ax, ay, 0, ax, ay, glowR);
      glow.addColorStop(0, isClosedTarget ? palette.storm : palette.onTime);
      glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.globalAlpha = palette.trailBlend === 'lighter' ? 0.28 : 0.14;
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(ax, ay, glowR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if (isClosedTarget && closure) {
      const beforeClosure = currentTimeMin < closure.startMin;
      const duringClosure = currentTimeMin >= closure.startMin && currentTimeMin < closure.endMin;

      if (beforeClosure) {
        const pulse = reducedMotion ? 0 : Math.sin(pulseTimeSec * 2.5) * 2.5;
        ctx.save();
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = palette.storm;
        ctx.lineWidth = 1.6;
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.arc(ax, ay, baseR + 14 + pulse, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        ctx.font = FONT_MONO_BADGE;
        drawPillZeroAlloc(
          ctx,
          `STORM ${closure.start}–${closure.end}`,
          ax,
          ay - baseR - 22,
          palette.panel,
          palette.storm,
          palette.storm,
          buffers
        );
      } else if (duringClosure) {
        ctx.save();
        ctx.strokeStyle = palette.storm;
        if (reducedMotion) {
          ctx.lineWidth = 1.75;
          ctx.globalAlpha = 0.72;
          ctx.beginPath();
          ctx.arc(ax, ay, baseR + 14, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 0.4;
          ctx.beginPath();
          ctx.arc(ax, ay, baseR + 26, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          for (let ring = 0; ring < 3; ring++) {
            const phase = (pulseTimeSec * 0.48 + ring / 3) % 1;
            const radius = baseR + 6 + phase * 34 * sc;
            ctx.globalAlpha = (1 - phase) * 0.72;
            ctx.lineWidth = 1.8 - phase * 0.8;
            ctx.beginPath();
            ctx.arc(ax, ay, radius, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
        ctx.restore();

        ctx.font = FONT_MONO_BADGE;
        drawPillZeroAlloc(
          ctx,
          `GROUND STOP UNTIL ${closure.end}`,
          ax,
          ay - baseR - 26,
          palette.panel,
          palette.storm,
          palette.ink,
          buffers
        );
      }
    }

    if (heldCount > 0) {
      const visualHalos = Math.min(12, heldCount);
      const orbitR = baseR + (isClosedTarget ? 11 : 9) * sc;
      const pulse = reducedMotion ? 0.85 : 0.55 + 0.45 * Math.sin(pulseTimeSec * 3.8);
      ctx.save();
      for (let h = 0; h < visualHalos; h++) {
        const theta = (h / visualHalos) * Math.PI * 2 - Math.PI * 0.5;
        const hx = ax + Math.cos(theta) * orbitR;
        const hy = ay + Math.sin(theta) * orbitR;
        ctx.globalAlpha = pulse;
        ctx.fillStyle = isClosedTarget ? palette.storm : palette.minorDelay;
        ctx.beginPath();
        ctx.arc(hx, hy, 2.5 * sc, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = palette.bg;
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
      ctx.restore();

      ctx.font = FONT_MONO_BADGE;
      drawPillZeroAlloc(
        ctx,
        `${heldCount} held`,
        ax,
        ay + baseR + 18,
        palette.panel,
        isClosedTarget ? palette.storm : palette.minorDelay,
        palette.ink,
        buffers,
        7,
        18
      );
    }

    if (isSelected || isHovered) {
      ctx.save();
      ctx.strokeStyle = isSelected ? palette.spare : palette.ink;
      ctx.lineWidth = isSelected ? 2 : 1.4;
      ctx.beginPath();
      ctx.arc(ax, ay, baseR + 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.beginPath();
    ctx.arc(ax, ay, baseR, 0, Math.PI * 2);
    ctx.fillStyle = isClosedTarget ? palette.storm : isSelected ? palette.spare : palette.ink;
    ctx.fill();
    ctx.lineWidth = 1.25;
    ctx.strokeStyle = palette.bg;
    ctx.stroke();
  }
}
