import {
  ARC_POINTS,
  FLAG_PREVIEW_CANCELLED,
  FLAG_PREVIEW_CHANGED,
  FLAG_SELECTED_FLIGHT,
  FLAG_SELECTED_TAIL,
  type SceneBuffers,
} from './arcBuffers.js';
import type { MapCamera } from './projection.js';

export type MapHitTarget =
  | { kind: 'flight'; flightId: string; tailId: string }
  | { kind: 'airport'; airportId: string }
  | null;

function pointToSegmentDistSq(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 0.0001) {
    const ex = px - ax;
    const ey = py - ay;
    return ex * ex + ey * ey;
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  const rx = px - cx;
  const ry = py - cy;
  return rx * rx + ry * ry;
}

/**
 * Hit-tests screen coordinates (x, y) against airborne planes, airports, and
 * active/visible route arcs with zero heap allocation.
 */
export function hitTestScene(
  x: number,
  y: number,
  camera: MapCamera,
  buffers: SceneBuffers,
  currentTimeMin: number
): MapHitTarget {
  const dataset = buffers.dataset;
  if (!dataset) return null;

  let bestPlaneIdx = -1;
  let bestPlaneDist = 22;

  for (let i = 0; i < buffers.flightCount; i++) {
    if (buffers.flightAirborne[i] !== 1) continue;
    const d = Math.hypot(x - buffers.flightScreenX[i], y - buffers.flightScreenY[i]);
    if (d < bestPlaneDist) {
      bestPlaneDist = d;
      bestPlaneIdx = i;
    }
  }

  let bestAirportIdx = -1;
  let bestAirportDist = Number.POSITIVE_INFINITY;

  for (let i = 0; i < buffers.airportCount; i++) {
    const cap = dataset.airports[i].capacity_per_hour;
    const hitRadius = Math.max(19, 3.2 + (cap / 40) * 4.5 + 11);
    const d = Math.hypot(x - buffers.airportX[i], y - buffers.airportY[i]);
    if (d <= hitRadius && d < bestAirportDist) {
      bestAirportDist = d;
      bestAirportIdx = i;
    }
  }

  if (bestPlaneIdx >= 0 && (bestAirportIdx < 0 || bestPlaneDist * 0.85 <= bestAirportDist)) {
    const f = buffers.activeFlightsOrdered[bestPlaneIdx];
    return { kind: 'flight', flightId: f.flight_id, tailId: f.operatingTail };
  }

  if (bestAirportIdx >= 0) {
    return { kind: 'airport', airportId: dataset.airports[bestAirportIdx].id };
  }

  // Fallback: check drawn route arcs (prioritizing selected / preview / active flights)
  let bestArcIdx = -1;
  let bestArcScore = 12;

  for (let i = 0; i < buffers.flightCount; i++) {
    const f = buffers.activeFlightsOrdered[i];
    const flags = buffers.flightMetaFlags[i];
    const isPreviewCancelled = (flags & FLAG_PREVIEW_CANCELLED) !== 0;
    if (f.cancelled && !isPreviewCancelled) continue;

    const isHighlighted =
      (flags & (FLAG_SELECTED_TAIL | FLAG_SELECTED_FLIGHT | FLAG_PREVIEW_CHANGED | FLAG_PREVIEW_CANCELLED)) !== 0;
    const isNearActive =
      currentTimeMin >= f.schedDepMin - 60 && currentTimeMin <= f.actualArrMin + 45;

    const baseOffset = i * ARC_POINTS * 3;
    let minDistSq = Number.POSITIVE_INFINITY;
    let prevValid = false;
    let prevX = 0;
    let prevY = 0;

    for (let k = 0; k < ARC_POINTS; k++) {
      const idx = baseOffset + k * 3;
      camera.project(
        buffers.arcCoords[idx],
        buffers.arcCoords[idx + 1],
        buffers.arcCoords[idx + 2],
        buffers.scratchPt
      );
      if (!buffers.scratchPt.visible) {
        prevValid = false;
        continue;
      }
      if (prevValid) {
        const dSq = pointToSegmentDistSq(
          x,
          y,
          prevX,
          prevY,
          buffers.scratchPt.x,
          buffers.scratchPt.y
        );
        if (dSq < minDistSq) {
          minDistSq = dSq;
        }
      }
      prevX = buffers.scratchPt.x;
      prevY = buffers.scratchPt.y;
      prevValid = true;
    }

    const dist = Math.sqrt(minDistSq);
    if (dist <= 12) {
      const priorityBonus = isHighlighted ? 4.5 : isNearActive ? 2.0 : 0;
      const score = dist - priorityBonus;
      if (score < bestArcScore) {
        bestArcScore = score;
        bestArcIdx = i;
      }
    }
  }

  if (bestArcIdx >= 0) {
    const f = buffers.activeFlightsOrdered[bestArcIdx];
    return { kind: 'flight', flightId: f.flight_id, tailId: f.operatingTail };
  }

  return null;
}
