import { MAX_LABEL_RECTS, type SceneBuffers } from './arcBuffers.js';
import { drawPillZeroAlloc, type RenderParams } from './drawAirports.js';
import {
  getFlightStatusColor,
  hasRectOverlap,
  pushRect,
  type ThemePalette,
} from './palettes.js';
import type { MapCamera } from './projection.js';

const FONT_MONO_LABEL = '500 11px "IBM Plex Mono", ui-monospace, monospace';
const FONT_MONO_TOOLTIP = '500 11px "IBM Plex Mono", ui-monospace, monospace';

/**
 * Renders priority-decluttered upright airport labels and active hover tooltip.
 */
export function drawDeclutteredLabelsLayer(
  ctx: CanvasRenderingContext2D,
  camera: MapCamera,
  buffers: SceneBuffers,
  palette: ThemePalette,
  params: RenderParams
): void {
  const dataset = buffers.dataset;
  if (!dataset) return;
  const area = camera.getVisibleArea();

  ctx.font = FONT_MONO_LABEL;
  if (!buffers.labelWidthsMeasured) {
    for (let i = 0; i < buffers.airportCount; i++) {
      buffers.airportLabelMeasuredWidth[i] = ctx.measureText(dataset.airports[i].id).width + 8;
    }
    buffers.labelWidthsMeasured = true;
  }

  for (let order = 0; order < buffers.airportCount; order++) {
    const idx = buffers.airportSortOrder[order];
    const airport = dataset.airports[idx];
    const ax = buffers.airportX[idx];
    const ay = buffers.airportY[idx];
    const sc = buffers.airportScale[idx];
    const baseR = (3.2 + (airport.capacity_per_hour / 40) * 4.5) * sc;
    const w = buffers.airportLabelMeasuredWidth[idx];
    const h = 15;
    const prio = buffers.airportPriority[idx];

    let placedX = 0;
    let placedY = 0;
    let placed = false;

    for (let c = 0; c < 4; c++) {
      let x0 = 0;
      let y0 = 0;
      if (c === 0) {
        x0 = ax + baseR + 6;
        y0 = ay - h * 0.5;
      } else if (c === 1) {
        x0 = ax - baseR - 6 - w;
        y0 = ay - h * 0.5;
      } else if (c === 2) {
        x0 = ax - w * 0.5;
        y0 = ay + baseR + 5;
      } else {
        x0 = ax - w * 0.5;
        y0 = ay - baseR - 5 - h;
      }

      const x1 = x0 + w;
      const y1 = y0 + h;
      if (x0 < area.left || x1 > area.right || y0 < area.top + 28 || y1 > area.bottom - 32) {
        continue;
      }
      if (!hasRectOverlap(buffers.placedLabelRects, buffers.placedLabelCount, x0, y0, x1, y1)) {
        buffers.placedLabelCount = pushRect(
          buffers.placedLabelRects,
          buffers.placedLabelCount,
          MAX_LABEL_RECTS,
          x0 - 2,
          y0 - 2,
          x1 + 2,
          y1 + 2
        );
        placedX = x0 + w * 0.5;
        placedY = y0 + h * 0.5;
        placed = true;
        break;
      }
    }

    if (!placed) continue;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (prio <= 2) {
      const borderCol =
        prio === 0 ? palette.storm : prio === 1 ? palette.spare : palette.panelBorder;
      drawPillZeroAlloc(ctx, airport.id, placedX, placedY, palette.panel, borderCol, palette.ink, null, 5, 16);
    } else {
      ctx.lineWidth = 3;
      ctx.strokeStyle = palette.bg;
      ctx.strokeText(airport.id, placedX, placedY);
      ctx.fillStyle = prio === 3 ? palette.ink : palette.muted;
      ctx.fillText(airport.id, placedX, placedY);
    }
  }

  const { hoveredFlightId, hoveredAirportId } = params;
  if (hoveredFlightId) {
    const fIdx = buffers.flightIndexById.get(hoveredFlightId);
    if (fIdx !== undefined) {
      const f = buffers.activeFlightsOrdered[fIdx];
      const oIdx = buffers.flightOriginIdx[fIdx];
      const hx =
        buffers.flightAirborne[fIdx] === 1
          ? buffers.flightScreenX[fIdx]
          : oIdx >= 0
            ? buffers.airportX[oIdx]
            : area.centerX;
      const hy =
        buffers.flightAirborne[fIdx] === 1
          ? buffers.flightScreenY[fIdx] - 20
          : (oIdx >= 0 ? buffers.airportY[oIdx] : area.centerY) - 22;
      const delayTxt = f.cancelled
        ? 'CANCELLED'
        : f.delayMin > 0
          ? `+${f.delayMin}m`
          : f.isSwapped
            ? 'SPARE'
            : 'ON TIME';
      const label = `${f.flight_id} · ${f.origin}→${f.destination} · ${delayTxt}`;
      ctx.font = FONT_MONO_TOOLTIP;
      const safeX = Math.max(area.left + 85, Math.min(area.right - 85, hx));
      const safeY = Math.max(area.top + 18, hy);
      drawPillZeroAlloc(
        ctx,
        label,
        safeX,
        safeY,
        palette.panel,
        getFlightStatusColor(f, palette),
        palette.ink,
        null,
        8,
        20
      );
    }
  } else if (hoveredAirportId) {
    const aIdx = buffers.airportIndexById.get(hoveredAirportId);
    if (aIdx !== undefined) {
      const airport = dataset.airports[aIdx];
      const held = buffers.airportHeldCount[aIdx];
      const label =
        held > 0
          ? `${airport.id} · ${airport.city} · ${held} held`
          : `${airport.id} · ${airport.city} · ${airport.capacity_per_hour}/hr`;
      ctx.font = FONT_MONO_TOOLTIP;
      const safeX = Math.max(area.left + 90, Math.min(area.right - 90, buffers.airportX[aIdx]));
      const safeY = Math.max(area.top + 18, buffers.airportY[aIdx] - 24);
      drawPillZeroAlloc(
        ctx,
        label,
        safeX,
        safeY,
        palette.panel,
        palette.panelBorder,
        palette.ink,
        null,
        8,
        20
      );
    }
  }
}
