import type {
  Airport,
  FlightNetworkDataset,
  SimulatedFlight,
  SimulationResult,
} from '../engine/types.js';
import {
  createProjectedPoint,
  greatCircleApproxKm,
  type ProjectedPoint,
} from './projection.js';
import {
  createMetadataScratch,
  FLAG_PREVIEW_CANCELLED,
  FLAG_PREVIEW_CHANGED,
  FLAG_SELECTED_FLIGHT,
  FLAG_SELECTED_TAIL,
  rebuildSceneMetadata,
  TRAIL_POINTS,
  updateCometTrails,
  type MetadataScratch,
} from './simMetadata.js';

export const ARC_SEGMENTS = 24;
export const ARC_POINTS = ARC_SEGMENTS + 1;
export const MAX_LABEL_RECTS = 32;

export {
  FLAG_PREVIEW_CANCELLED,
  FLAG_PREVIEW_CHANGED,
  FLAG_SELECTED_FLIGHT,
  FLAG_SELECTED_TAIL,
  TRAIL_POINTS,
};

/**
 * Precomputed typed-array geometry, ring-buffer comet trails, and zero-allocation
 * per-frame scratch buffers for the Canvas 2D flight map.
 */
export class SceneBuffers {
  private readonly radialGlowSprites = new Map<string, CanvasImageSource | null>();
  dataset: FlightNetworkDataset | null = null;
  simulation: SimulationResult | null = null;
  previewSimulation: SimulationResult | null = null;
  selectedFlightId: string | null = null;
  selectedTailId: string | null = null;
  selectedAirportId: string | null = null;

  flightCount = 0;
  airportCount = 0;

  airportIndexById = new Map<string, number>();
  flightIndexById = new Map<string, number>();
  flightOriginIdx: Int16Array = new Int16Array(0);
  flightDestIdx: Int16Array = new Int16Array(0);

  /** Flat [lat, lng, altKm] for all flight arcs: flightCount * ARC_POINTS * 3 */
  arcCoords: Float32Array = new Float32Array(0);
  flightMetaFlags: Uint8Array = new Uint8Array(0);

  /** Pre-allocated comet trail ring buffers: flightCount * TRAIL_POINTS * 3 */
  trailCoords: Float32Array = new Float32Array(0);
  trailHead: Uint8Array = new Uint8Array(0);
  trailCount: Uint8Array = new Uint8Array(0);
  trailLastU: Float32Array = new Float32Array(0);
  lastTrailTimeMin = Number.NaN;

  /** Per-frame zero-allocation scratch arrays */
  readonly scratchArcX = new Float32Array(ARC_POINTS);
  readonly scratchArcY = new Float32Array(ARC_POINTS);
  readonly scratchTrailX = new Float32Array(TRAIL_POINTS);
  readonly scratchTrailY = new Float32Array(TRAIL_POINTS);
  readonly scratchSample = new Float32Array(3);
  readonly scratchPt: ProjectedPoint = createProjectedPoint();
  readonly scratchPtNext: ProjectedPoint = createProjectedPoint();

  airportX: Float32Array = new Float32Array(0);
  airportY: Float32Array = new Float32Array(0);
  airportScale: Float32Array = new Float32Array(0);
  airportDepth: Float32Array = new Float32Array(0);
  airportHeldCount: Uint16Array = new Uint16Array(0);
  airportPriority: Uint8Array = new Uint8Array(0);
  airportSortOrder: Int32Array = new Int32Array(0);
  airportLabelMeasuredWidth: Float32Array = new Float32Array(0);
  labelWidthsMeasured = false;

  /** Returns a cached radial glow sprite, or null when this runtime cannot create a canvas. */
  getRadialGlowSprite(color: string): CanvasImageSource | null {
    if (this.radialGlowSprites.has(color)) return this.radialGlowSprites.get(color) ?? null;

    let canvas: HTMLCanvasElement | OffscreenCanvas | null = null;
    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
      canvas = document.createElement('canvas');
    } else if (typeof OffscreenCanvas !== 'undefined') {
      canvas = new OffscreenCanvas(128, 128);
    }
    if (!canvas) {
      this.radialGlowSprites.set(color, null);
      return null;
    }

    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    if (!context) {
      this.radialGlowSprites.set(color, null);
      return null;
    }

    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
    this.radialGlowSprites.set(color, canvas);
    return canvas;
  }

  flightScreenX: Float32Array = new Float32Array(0);
  flightScreenY: Float32Array = new Float32Array(0);
  flightScreenAngle: Float32Array = new Float32Array(0);
  flightAirborne: Uint8Array = new Uint8Array(0);

  /** Flat [x0, y0, x1, y1] rect buffer for label decluttering */
  readonly placedLabelRects = new Float32Array(MAX_LABEL_RECTS * 4);
  placedLabelCount = 0;

  /** Cached background gradient to avoid per-frame allocation */
  cachedBgGrad: CanvasGradient | null = null;
  cachedGradKey = '';

  activeFlightsOrdered: SimulatedFlight[] = [];
  private readonly metaScratch: MetadataScratch = createMetadataScratch();

  /**
   * Synchronizes precomputed geometry and state flags. Allocates typed arrays ONLY
   * when dataset changes, returning true if comet trails should hard-reset.
   */
  sync(
    dataset: FlightNetworkDataset,
    simulation: SimulationResult,
    previewSimulation: SimulationResult | null,
    selectedFlightId: string | null,
    selectedTailId: string | null,
    selectedAirportId: string | null
  ): boolean {
    let datasetChanged = false;
    if (this.dataset !== dataset) {
      this.buildDatasetBuffers(dataset);
      datasetChanged = true;
    }

    const simChanged =
      datasetChanged ||
      this.simulation !== simulation ||
      this.previewSimulation !== previewSimulation;

    const selectionChanged =
      this.selectedFlightId !== selectedFlightId ||
      this.selectedTailId !== selectedTailId ||
      this.selectedAirportId !== selectedAirportId;

    if (simChanged || selectionChanged) {
      this.simulation = simulation;
      this.previewSimulation = previewSimulation;
      this.selectedFlightId = selectedFlightId;
      this.selectedTailId = selectedTailId;
      this.selectedAirportId = selectedAirportId;
      rebuildSceneMetadata(
        this,
        this.metaScratch,
        dataset,
        simulation,
        previewSimulation,
        selectedFlightId,
        selectedTailId,
        selectedAirportId
      );
    }

    return simChanged;
  }

  private buildDatasetBuffers(dataset: FlightNetworkDataset): void {
    this.dataset = dataset;
    this.flightCount = dataset.flights.length;
    this.airportCount = dataset.airports.length;
    this.labelWidthsMeasured = false;

    this.airportIndexById.clear();
    for (let i = 0; i < this.airportCount; i++) {
      this.airportIndexById.set(dataset.airports[i].id, i);
    }

    this.flightIndexById.clear();
    this.flightOriginIdx = new Int16Array(this.flightCount);
    this.flightDestIdx = new Int16Array(this.flightCount);
    this.arcCoords = new Float32Array(this.flightCount * ARC_POINTS * 3);
    this.flightMetaFlags = new Uint8Array(this.flightCount);

    this.trailCoords = new Float32Array(this.flightCount * TRAIL_POINTS * 3);
    this.trailHead = new Uint8Array(this.flightCount);
    this.trailCount = new Uint8Array(this.flightCount);
    this.trailLastU = new Float32Array(this.flightCount);
    this.trailLastU.fill(-1);

    this.airportX = new Float32Array(this.airportCount);
    this.airportY = new Float32Array(this.airportCount);
    this.airportScale = new Float32Array(this.airportCount);
    this.airportDepth = new Float32Array(this.airportCount);
    this.airportHeldCount = new Uint16Array(this.airportCount);
    this.airportPriority = new Uint8Array(this.airportCount);
    this.airportSortOrder = new Int32Array(this.airportCount);
    this.airportLabelMeasuredWidth = new Float32Array(this.airportCount);

    this.flightScreenX = new Float32Array(this.flightCount);
    this.flightScreenY = new Float32Array(this.flightCount);
    this.flightScreenAngle = new Float32Array(this.flightCount);
    this.flightAirborne = new Uint8Array(this.flightCount);
    this.activeFlightsOrdered = new Array<SimulatedFlight>(this.flightCount);

    for (let i = 0; i < this.flightCount; i++) {
      const f = dataset.flights[i];
      this.flightIndexById.set(f.flight_id, i);
      const oIdx = this.airportIndexById.get(f.origin) ?? -1;
      const dIdx = this.airportIndexById.get(f.destination) ?? -1;
      this.flightOriginIdx[i] = oIdx;
      this.flightDestIdx[i] = dIdx;

      const orig: Airport | undefined = oIdx >= 0 ? dataset.airports[oIdx] : undefined;
      const dest: Airport | undefined = dIdx >= 0 ? dataset.airports[dIdx] : undefined;
      if (!orig || !dest) continue;

      const distKm = greatCircleApproxKm(orig.lat, orig.lng, dest.lat, dest.lng);
      const peakAltKm = Math.min(340, Math.max(75, 55 + distKm * 0.125));
      const dLat = dest.lat - orig.lat;
      const dLng = dest.lng - orig.lng;
      const degLen = Math.hypot(dLat, dLng) || 1;
      const nLat = -dLng / degLen;
      const nLng = dLat / degLen;
      const bowDeg = Math.min(0.24, degLen * 0.035);

      const baseOffset = i * ARC_POINTS * 3;
      for (let k = 0; k < ARC_POINTS; k++) {
        const u = k / ARC_SEGMENTS;
        const parabola = 4 * u * (1 - u);
        const idx = baseOffset + k * 3;
        this.arcCoords[idx] = orig.lat + dLat * u + nLat * bowDeg * parabola;
        this.arcCoords[idx + 1] = orig.lng + dLng * u + nLng * bowDeg * parabola;
        this.arcCoords[idx + 2] = peakAltKm * parabola;
      }
    }
  }

  /**
   * Samples [lat, lng, altKm] at normalized progress u in [0, 1] along precomputed flight arc.
   */
  sampleArc(flightIdx: number, u: number, out: Float32Array): void {
    const clamped = u <= 0 ? 0 : u >= 1 ? 1 : u;
    const fSeg = clamped * ARC_SEGMENTS;
    const seg0 = Math.min(ARC_SEGMENTS - 1, Math.floor(fSeg));
    const frac = fSeg - seg0;

    const idx0 = (flightIdx * ARC_POINTS + seg0) * 3;
    const idx1 = idx0 + 3;
    out[0] = this.arcCoords[idx0] + (this.arcCoords[idx1] - this.arcCoords[idx0]) * frac;
    out[1] = this.arcCoords[idx0 + 1] + (this.arcCoords[idx1 + 1] - this.arcCoords[idx0 + 1]) * frac;
    out[2] = this.arcCoords[idx0 + 2] + (this.arcCoords[idx1 + 2] - this.arcCoords[idx0 + 2]) * frac;
  }

  /**
   * Resets all comet trail ring buffers cleanly.
   */
  resetTrails(): void {
    this.trailHead.fill(0);
    this.trailCount.fill(0);
    this.trailLastU.fill(-1);
  }

  /**
   * Updates airborne status and comet trail ring buffers for `currentTimeMin`.
   */
  updateTrailsAndFlightState(currentTimeMin: number, forceReset: boolean): void {
    updateCometTrails(this, currentTimeMin, forceReset);
  }
}
