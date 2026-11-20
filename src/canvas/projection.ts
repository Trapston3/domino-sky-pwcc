import { INDIA_CENTER_LAT, INDIA_CENTER_LNG } from './indiaGeo.js';

export const PITCH_2D_DEG = 0;
export const PITCH_3D_DEG = 38;
export const MIN_PITCH_DEG = 0;
export const MAX_PITCH_DEG = 46;
export const MIN_YAW_DEG = -22;
export const MAX_YAW_DEG = 22;

const DEG_TO_RAD = Math.PI / 180;
const KM_PER_DEG_LAT = 111.132;
const KM_PER_DEG_LNG = KM_PER_DEG_LAT * Math.cos(INDIA_CENTER_LAT * DEG_TO_RAD);
const CAMERA_DIST_KM = 5200;

export interface ProjectedPoint {
  x: number;
  y: number;
  scale: number;
  depth: number;
  visible: boolean;
}

/**
 * Allocates a reusable scratch object for zero-allocation projections.
 */
export function createProjectedPoint(): ProjectedPoint {
  return { x: 0, y: 0, scale: 1, depth: CAMERA_DIST_KM, visible: true };
}

/**
 * Computes approximate planar distance in kilometers between two geographic coordinates.
 */
export function greatCircleApproxKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const midLatRad = ((lat1 + lat2) * 0.5) * DEG_TO_RAD;
  const dLatKm = (lat2 - lat1) * KM_PER_DEG_LAT;
  const dLngKm = (lng2 - lng1) * KM_PER_DEG_LAT * Math.cos(midLatRad);
  return Math.hypot(dLatKm, dLngKm);
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Hand-written 3D perspective camera projecting (lat, lng, altKm) into screen space.
 * Supports smooth 2D <-> 3D transitions and bounded drag tilt/yaw while keeping India centered.
 */
export class MapCamera {
  private pitchDeg: number;
  private yawDeg = 0;
  private targetPitchDeg: number;
  private targetYawDeg = 0;
  private modeIs3D: boolean;

  private cosPitch = 1;
  private sinPitch = 0;
  private cosYaw = 1;
  private sinYaw = 0;

  private width = 1200;
  private height = 800;
  private rightInsetPx = 0;
  private centerX = 600;
  private centerY = 408;
  private focalScale = 1200;

  constructor(initialIs3D: boolean) {
    this.modeIs3D = initialIs3D;
    this.pitchDeg = initialIs3D ? PITCH_3D_DEG : PITCH_2D_DEG;
    this.targetPitchDeg = this.pitchDeg;
    this.updateTrigAndScale();
  }

  /**
   * Updates viewport dimensions and horizontal right-rail inset, keeping India centered
   * in the unobstructed map region.
   */
  setViewport(width: number, height: number, rightPanelInsetPx = 0): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.rightInsetPx = clamp(rightPanelInsetPx, 0, this.width * 0.55);
    this.updateTrigAndScale();
  }

  /**
   * Transitions between 2D top-down (0 deg) and 3D perspective (38 deg).
   */
  setIs3D(is3D: boolean, reducedMotion: boolean): void {
    const changed = is3D !== this.modeIs3D;
    this.modeIs3D = is3D;
    if (changed) {
      this.targetPitchDeg = is3D ? PITCH_3D_DEG : PITCH_2D_DEG;
      this.targetYawDeg = 0;
    }
    if (reducedMotion) {
      this.pitchDeg = this.targetPitchDeg;
      this.yawDeg = this.targetYawDeg;
      this.updateTrigAndScale();
    }
  }

  /**
   * Applies pointer drag deltas to tilt (pitch 0..46 deg) and yaw (-22..+22 deg).
   */
  applyDragDelta(dxPx: number, dyPx: number): void {
    this.yawDeg = clamp(this.yawDeg + dxPx * 0.14, MIN_YAW_DEG, MAX_YAW_DEG);
    this.pitchDeg = clamp(this.pitchDeg - dyPx * 0.14, MIN_PITCH_DEG, MAX_PITCH_DEG);
    this.targetYawDeg = this.yawDeg;
    this.targetPitchDeg = this.pitchDeg;
    this.updateTrigAndScale();
  }

  /**
   * Resets user drag tilt/yaw back to the active 2D/3D mode default.
   */
  resetDrag(reducedMotion: boolean): void {
    this.targetPitchDeg = this.modeIs3D ? PITCH_3D_DEG : PITCH_2D_DEG;
    this.targetYawDeg = 0;
    if (reducedMotion) {
      this.pitchDeg = this.targetPitchDeg;
      this.yawDeg = 0;
      this.updateTrigAndScale();
    }
  }

  /**
   * Advances camera easing for one frame. Returns true while still transitioning.
   */
  step(dtSec: number): boolean {
    const dp = this.targetPitchDeg - this.pitchDeg;
    const dy = this.targetYawDeg - this.yawDeg;
    if (Math.abs(dp) < 0.03 && Math.abs(dy) < 0.03) {
      if (dp !== 0 || dy !== 0) {
        this.pitchDeg = this.targetPitchDeg;
        this.yawDeg = this.targetYawDeg;
        this.updateTrigAndScale();
      }
      return false;
    }

    const alpha = 1 - Math.exp(-Math.min(0.1, Math.max(0.001, dtSec)) * 9.5);
    this.pitchDeg += dp * alpha;
    this.yawDeg += dy * alpha;
    this.updateTrigAndScale();
    return true;
  }

  /**
   * Returns true if the camera is currently easing toward target pitch/yaw.
   */
  isTransitioning(): boolean {
    return (
      Math.abs(this.targetPitchDeg - this.pitchDeg) >= 0.03 ||
      Math.abs(this.targetYawDeg - this.yawDeg) >= 0.03
    );
  }

  /**
   * Returns current pitch/yaw angles in degrees.
   */
  getAngles(): { pitchDeg: number; yawDeg: number } {
    return { pitchDeg: this.pitchDeg, yawDeg: this.yawDeg };
  }

  /**
   * Returns current visible map bounds (excluding right rail inset).
   */
  getVisibleArea(): {
    left: number;
    top: number;
    right: number;
    bottom: number;
    centerX: number;
    centerY: number;
  } {
    const visibleWidth = Math.max(220, this.width - this.rightInsetPx);
    return {
      left: 12,
      top: 12,
      right: visibleWidth - 12,
      bottom: this.height - 12,
      centerX: this.centerX,
      centerY: this.centerY,
    };
  }

  /**
   * Zero-allocation projection of (lat, lng, altKm) into pre-allocated `out`.
   */
  project(lat: number, lng: number, altKm: number, out: ProjectedPoint): ProjectedPoint {
    const wx = (lng - INDIA_CENTER_LNG) * KM_PER_DEG_LNG;
    const wy = (lat - INDIA_CENTER_LAT) * KM_PER_DEG_LAT;
    const wz = altKm;

    const x1 = wx * this.cosYaw + wy * this.sinYaw;
    const y1 = -wx * this.sinYaw + wy * this.cosYaw;

    const camX = x1;
    const camY = y1 * this.cosPitch + wz * this.sinPitch;
    const depth = CAMERA_DIST_KM + y1 * this.sinPitch - wz * this.cosPitch;

    if (depth <= 120) {
      out.x = 0;
      out.y = 0;
      out.scale = 0;
      out.depth = depth;
      out.visible = false;
      return out;
    }

    const persp = this.focalScale / depth;
    out.x = this.centerX + camX * persp;
    out.y = this.centerY - camY * persp;
    out.scale = CAMERA_DIST_KM / depth;
    out.depth = depth;
    out.visible = true;
    return out;
  }

  private updateTrigAndScale(): void {
    const pitchRad = this.pitchDeg * DEG_TO_RAD;
    const yawRad = this.yawDeg * DEG_TO_RAD;
    this.cosPitch = Math.cos(pitchRad);
    this.sinPitch = Math.sin(pitchRad);
    this.cosYaw = Math.cos(yawRad);
    this.sinYaw = Math.sin(yawRad);

    const visibleWidth = Math.max(220, this.width - this.rightInsetPx);
    this.centerX = visibleWidth * 0.5;
    this.centerY = this.height * 0.51;

    const usableW = Math.max(200, visibleWidth - 56);
    const usableH = Math.max(220, this.height - 148);
    const pitchSpanFactor = 0.84 + 0.16 * this.cosPitch;
    const pxPerKm = Math.min(usableW / 3220, usableH / (3360 * pitchSpanFactor));
    this.focalScale = pxPerKm * CAMERA_DIST_KM;
  }
}
