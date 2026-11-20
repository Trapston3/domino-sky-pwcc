import {
  FLAG_PREVIEW_CHANGED,
  TRAIL_POINTS,
  type SceneBuffers,
} from './arcBuffers.js';
import type { RenderParams } from './drawAirports.js';
import { getFlightStatusColor, type ThemePalette } from './palettes.js';
import type { MapCamera } from './projection.js';

/**
 * Draws additive-blend comet trails from ring buffers and oriented aircraft chevrons.
 */
export function drawTrailsAndPlanesLayer(
  ctx: CanvasRenderingContext2D,
  camera: MapCamera,
  buffers: SceneBuffers,
  palette: ThemePalette,
  params: RenderParams
): void {
  const { currentTimeMin, isPreviewActive, selectedFlightId, hoveredFlightId } = params;

  for (let i = 0; i < buffers.flightCount; i++) {
    const f = buffers.activeFlightsOrdered[i];
    const flags = buffers.flightMetaFlags[i];
    const isPreviewChanged = isPreviewActive && (flags & FLAG_PREVIEW_CHANGED) !== 0;
    const isSelected = f.flight_id === selectedFlightId;
    const isHovered = f.flight_id === hoveredFlightId;
    const color = getFlightStatusColor(f, palette, isPreviewChanged);

    if (buffers.flightAirborne[i] !== 1) {
      if (isSelected && !f.cancelled) {
        const anchorIdx =
          currentTimeMin < f.actualDepMin ? buffers.flightOriginIdx[i] : buffers.flightDestIdx[i];
        if (anchorIdx >= 0) {
          ctx.save();
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.arc(buffers.airportX[anchorIdx], buffers.airportY[anchorIdx], 12, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }
      continue;
    }

    const tCount = buffers.trailCount[i];
    if (tCount >= 2) {
      const oldestIdx = (buffers.trailHead[i] - tCount + TRAIL_POINTS) % TRAIL_POINTS;
      const baseSlot = i * TRAIL_POINTS * 3;
      let validCount = 0;

      for (let k = 0; k < tCount; k++) {
        const slot = (oldestIdx + k) % TRAIL_POINTS;
        const off = baseSlot + slot * 3;
        camera.project(
          buffers.trailCoords[off],
          buffers.trailCoords[off + 1],
          buffers.trailCoords[off + 2],
          buffers.scratchPt
        );
        if (!buffers.scratchPt.visible) continue;
        buffers.scratchTrailX[validCount] = buffers.scratchPt.x;
        buffers.scratchTrailY[validCount] = buffers.scratchPt.y;
        validCount += 1;
      }

      if (validCount >= 2) {
        ctx.save();
        ctx.globalCompositeOperation = palette.trailBlend;
        ctx.strokeStyle = color;
        ctx.lineCap = 'round';
        for (let k = 1; k < validCount; k++) {
          const frac = k / (validCount - 1);
          ctx.globalAlpha = (palette.trailBlend === 'lighter' ? 0.08 : 0.16) + frac * 0.78;
          ctx.lineWidth = 0.7 + frac * (isSelected || isHovered ? 3.2 : 2.3);
          ctx.beginPath();
          ctx.moveTo(buffers.scratchTrailX[k - 1], buffers.scratchTrailY[k - 1]);
          ctx.lineTo(buffers.scratchTrailX[k], buffers.scratchTrailY[k]);
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    const dur = f.actualArrMin - f.actualDepMin;
    const u = dur > 0 ? (currentTimeMin - f.actualDepMin) / dur : 0;
    buffers.sampleArc(i, u, buffers.scratchSample);
    camera.project(
      buffers.scratchSample[0],
      buffers.scratchSample[1],
      buffers.scratchSample[2],
      buffers.scratchPt
    );
    if (!buffers.scratchPt.visible) continue;

    const uLook = u < 0.96 ? u + 0.025 : Math.max(0, u - 0.025);
    buffers.sampleArc(i, uLook, buffers.scratchSample);
    camera.project(
      buffers.scratchSample[0],
      buffers.scratchSample[1],
      buffers.scratchSample[2],
      buffers.scratchPtNext
    );

    const dx = buffers.scratchPtNext.x - buffers.scratchPt.x;
    const dy = buffers.scratchPtNext.y - buffers.scratchPt.y;
    const angle = u < 0.96 ? Math.atan2(dy, dx) : Math.atan2(-dy, -dx);

    const px = buffers.scratchPt.x;
    const py = buffers.scratchPt.y;
    buffers.flightScreenX[i] = px;
    buffers.flightScreenY[i] = py;
    buffers.flightScreenAngle[i] = angle;

    const size =
      (isSelected || isHovered ? 1.25 : 1.0) *
      Math.max(0.85, Math.min(1.25, buffers.scratchPt.scale));

    if (isSelected || isHovered || f.isSwapped || isPreviewChanged) {
      ctx.save();
      ctx.strokeStyle = f.isSwapped || isPreviewChanged ? palette.spare : color;
      ctx.lineWidth = isSelected ? 2 : 1.3;
      ctx.beginPath();
      ctx.arc(px, py, 10 * size, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);
    ctx.scale(size, size);
    ctx.beginPath();
    ctx.moveTo(7.5, 0);
    ctx.lineTo(-5, -4.6);
    ctx.lineTo(-2.3, 0);
    ctx.lineTo(-5, 4.6);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 1.1;
    ctx.strokeStyle = palette.bg;
    ctx.stroke();
    ctx.restore();
  }
}
