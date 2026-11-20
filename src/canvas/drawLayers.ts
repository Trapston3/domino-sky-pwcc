import type { SimulationResult } from '../engine/types.js';
import {
  ARC_POINTS,
  FLAG_PREVIEW_CANCELLED,
  FLAG_PREVIEW_CHANGED,
  FLAG_SELECTED_FLIGHT,
  FLAG_SELECTED_TAIL,
  type SceneBuffers,
} from './arcBuffers.js';
import { drawAirportsAndStormLayer, type RenderParams } from './drawAirports.js';
import { drawDeclutteredLabelsLayer } from './drawLabels.js';
import { drawTrailsAndPlanesLayer } from './drawPlanes.js';
import { INDIA_BORDER_COORDS, INDIA_LAND_DOTS } from './indiaGeo.js';
import { getCanvasPalette, getFlightStatusColor, type ThemePalette } from './palettes.js';
import type { MapCamera } from './projection.js';

export type { RenderParams };

function drawLandmassLayer(
  ctx: CanvasRenderingContext2D,
  camera: MapCamera,
  buffers: SceneBuffers,
  palette: ThemePalette,
  params: RenderParams
): void {
  const { width, height } = params;
  const area = camera.getVisibleArea();
  const gradKey = `${width}x${height}:${Math.round(area.centerX)}:${params.theme}`;
  if (buffers.cachedGradKey !== gradKey || !buffers.cachedBgGrad) {
    const grad = ctx.createRadialGradient(
      area.centerX,
      area.centerY,
      20,
      area.centerX,
      area.centerY,
      Math.max(width, height) * 0.65
    );
    grad.addColorStop(0, palette.bgCenter);
    grad.addColorStop(1, palette.bg);
    buffers.cachedBgGrad = grad;
    buffers.cachedGradKey = gradKey;
  }
  ctx.fillStyle = buffers.cachedBgGrad;
  ctx.fillRect(0, 0, width, height);

  // Subtle lat/lng graticule over India
  ctx.strokeStyle = palette.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let lat = 10; lat <= 35; lat += 5) {
    let started = false;
    for (let lng = 68; lng <= 98; lng += 3) {
      camera.project(lat, lng, 0, buffers.scratchPt);
      if (!buffers.scratchPt.visible) continue;
      if (!started) {
        ctx.moveTo(buffers.scratchPt.x, buffers.scratchPt.y);
        started = true;
      } else {
        ctx.lineTo(buffers.scratchPt.x, buffers.scratchPt.y);
      }
    }
  }
  for (let lng = 70; lng <= 95; lng += 5) {
    let started = false;
    for (let lat = 7; lat <= 37; lat += 3) {
      camera.project(lat, lng, 0, buffers.scratchPt);
      if (!buffers.scratchPt.visible) continue;
      if (!started) {
        ctx.moveTo(buffers.scratchPt.x, buffers.scratchPt.y);
        started = true;
      } else {
        ctx.lineTo(buffers.scratchPt.x, buffers.scratchPt.y);
      }
    }
  }
  ctx.stroke();

  // Mainland India border polygon fill + outline
  ctx.beginPath();
  const borderLen = INDIA_BORDER_COORDS.length;
  for (let i = 0; i < borderLen; i += 2) {
    camera.project(INDIA_BORDER_COORDS[i], INDIA_BORDER_COORDS[i + 1], 0, buffers.scratchPt);
    if (i === 0) ctx.moveTo(buffers.scratchPt.x, buffers.scratchPt.y);
    else ctx.lineTo(buffers.scratchPt.x, buffers.scratchPt.y);
  }
  ctx.closePath();
  ctx.fillStyle = palette.landFill;
  ctx.fill();
  ctx.strokeStyle = palette.border;
  ctx.lineWidth = 1.25;
  ctx.stroke();

  // Precomputed interior landmass dots
  ctx.fillStyle = palette.landDot;
  const dotLen = INDIA_LAND_DOTS.length;
  for (let i = 0; i < dotLen; i += 2) {
    camera.project(INDIA_LAND_DOTS[i], INDIA_LAND_DOTS[i + 1], 0, buffers.scratchPt);
    if (!buffers.scratchPt.visible) continue;
    const s = 1.75 * buffers.scratchPt.scale;
    ctx.fillRect(buffers.scratchPt.x - s * 0.5, buffers.scratchPt.y - s * 0.5, s, s);
  }
}

function traceArcScreenPath(
  ctx: CanvasRenderingContext2D,
  camera: MapCamera,
  buffers: SceneBuffers,
  flightIdx: number
): void {
  const baseOffset = flightIdx * ARC_POINTS * 3;
  ctx.beginPath();
  for (let k = 0; k < ARC_POINTS; k++) {
    const idx = baseOffset + k * 3;
    camera.project(
      buffers.arcCoords[idx],
      buffers.arcCoords[idx + 1],
      buffers.arcCoords[idx + 2],
      buffers.scratchPt
    );
    buffers.scratchArcX[k] = buffers.scratchPt.x;
    buffers.scratchArcY[k] = buffers.scratchPt.y;
    if (k === 0) ctx.moveTo(buffers.scratchPt.x, buffers.scratchPt.y);
    else ctx.lineTo(buffers.scratchPt.x, buffers.scratchPt.y);
  }
}

function drawRouteArcsLayer(
  ctx: CanvasRenderingContext2D,
  camera: MapCamera,
  buffers: SceneBuffers,
  palette: ThemePalette,
  params: RenderParams
): void {
  const { currentTimeMin, isPreviewActive, hoveredFlightId } = params;

  // Pass 1: Faint baseline / scheduled non-cancelled arcs
  ctx.lineWidth = 1;
  ctx.strokeStyle = palette.routeBase;
  for (let i = 0; i < buffers.flightCount; i++) {
    const f = buffers.activeFlightsOrdered[i];
    const flags = buffers.flightMetaFlags[i];
    if (f.cancelled || (flags & (FLAG_SELECTED_TAIL | FLAG_PREVIEW_CHANGED)) !== 0) continue;
    traceArcScreenPath(ctx, camera, buffers, i);
    ctx.stroke();
  }

  // Pass 2: Active / delayed arcs near currentTimeMin + preview + selected tail chain
  for (let i = 0; i < buffers.flightCount; i++) {
    const f = buffers.activeFlightsOrdered[i];
    const flags = buffers.flightMetaFlags[i];
    const isPreviewCancelled = (flags & FLAG_PREVIEW_CANCELLED) !== 0;
    const isPreviewChanged = (flags & FLAG_PREVIEW_CHANGED) !== 0;
    const isSelectedTail = (flags & FLAG_SELECTED_TAIL) !== 0;
    const isSelectedFlight = (flags & FLAG_SELECTED_FLIGHT) !== 0;
    const isHovered = hoveredFlightId === f.flight_id;
    const isAirborne = buffers.flightAirborne[i] === 1;
    const isHeldNow = !f.cancelled && currentTimeMin >= f.schedDepMin && currentTimeMin < f.actualDepMin;

    if (
      !isPreviewCancelled &&
      !isPreviewChanged &&
      !isSelectedTail &&
      !isSelectedFlight &&
      !isHovered &&
      !isAirborne &&
      !isHeldNow
    ) {
      continue;
    }
    if (f.cancelled && !isPreviewCancelled) continue;

    traceArcScreenPath(ctx, camera, buffers, i);

    if (isPreviewCancelled) {
      ctx.save();
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = palette.majorBreach;
      ctx.globalAlpha = 0.86;
      ctx.lineWidth = 1.9;
      ctx.stroke();
      ctx.restore();

      const mx = buffers.scratchArcX[12];
      const my = buffers.scratchArcY[12];
      ctx.strokeStyle = palette.majorBreach;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(mx - 4, my - 4);
      ctx.lineTo(mx + 4, my + 4);
      ctx.moveTo(mx + 4, my - 4);
      ctx.lineTo(mx - 4, my + 4);
      ctx.stroke();
      continue;
    }

    const forceSpare = isPreviewActive && isPreviewChanged;
    const strokeColor = getFlightStatusColor(f, palette, forceSpare);
    ctx.save();
    ctx.strokeStyle = strokeColor;
    if (isSelectedFlight || isHovered) {
      ctx.globalAlpha = 0.96;
      ctx.lineWidth = 2.8;
    } else if (isSelectedTail || forceSpare) {
      ctx.globalAlpha = 0.82;
      ctx.lineWidth = 2.1;
    } else {
      ctx.globalAlpha = isAirborne ? 0.34 : 0.28;
      ctx.lineWidth = 1.25;
    }
    ctx.stroke();
    ctx.restore();
  }
}

function drawGroundShadowsLayer(
  ctx: CanvasRenderingContext2D,
  camera: MapCamera,
  buffers: SceneBuffers,
  palette: ThemePalette,
  params: RenderParams
): void {
  const { currentTimeMin, selectedFlightId, hoveredFlightId } = params;
  const isTilted = camera.getAngles().pitchDeg > 4;

  for (let i = 0; i < buffers.flightCount; i++) {
    if (buffers.flightAirborne[i] !== 1) continue;
    const f = buffers.activeFlightsOrdered[i];
    const dur = f.actualArrMin - f.actualDepMin;
    const u = dur > 0 ? (currentTimeMin - f.actualDepMin) / dur : 0;

    buffers.sampleArc(i, u, buffers.scratchSample);
    camera.project(buffers.scratchSample[0], buffers.scratchSample[1], 0, buffers.scratchPt);
    if (!buffers.scratchPt.visible) continue;

    const uNext = u < 0.96 ? u + 0.025 : Math.max(0, u - 0.025);
    buffers.sampleArc(i, uNext, buffers.scratchSample);
    camera.project(buffers.scratchSample[0], buffers.scratchSample[1], 0, buffers.scratchPtNext);

    const dx = buffers.scratchPtNext.x - buffers.scratchPt.x;
    const dy = buffers.scratchPtNext.y - buffers.scratchPt.y;
    const angle = u < 0.96 ? Math.atan2(dy, dx) : Math.atan2(-dy, -dx);

    ctx.save();
    ctx.translate(buffers.scratchPt.x, buffers.scratchPt.y);
    ctx.rotate(angle);
    ctx.fillStyle = palette.shadow;
    ctx.beginPath();
    ctx.ellipse(0, 0, 5.5 * buffers.scratchPt.scale, 2.0 * buffers.scratchPt.scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (isTilted && (f.flight_id === selectedFlightId || f.flight_id === hoveredFlightId)) {
      buffers.sampleArc(i, u, buffers.scratchSample);
      camera.project(buffers.scratchSample[0], buffers.scratchSample[1], buffers.scratchSample[2], buffers.scratchPtNext);
      ctx.save();
      ctx.setLineDash([2, 3]);
      ctx.strokeStyle = palette.muted;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(buffers.scratchPt.x, buffers.scratchPt.y);
      ctx.lineTo(buffers.scratchPtNext.x, buffers.scratchPtNext.y);
      ctx.stroke();
      ctx.restore();
    }
  }
}

/**
 * Renders one complete frame of the Domino Sky 2D/3D map onto a Canvas 2D context
 * with zero per-frame allocations.
 */
export function renderFlightScene(
  ctx: CanvasRenderingContext2D,
  camera: MapCamera,
  buffers: SceneBuffers,
  simulation: SimulationResult,
  params: RenderParams
): void {
  buffers.placedLabelCount = 0;
  const palette = getCanvasPalette(params.theme);

  drawLandmassLayer(ctx, camera, buffers, palette, params);
  drawRouteArcsLayer(ctx, camera, buffers, palette, params);
  drawGroundShadowsLayer(ctx, camera, buffers, palette, params);
  drawAirportsAndStormLayer(ctx, camera, buffers, simulation, palette, params);
  drawTrailsAndPlanesLayer(ctx, camera, buffers, palette, params);
  drawDeclutteredLabelsLayer(ctx, camera, buffers, palette, params);
}
