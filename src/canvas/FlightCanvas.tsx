import { useEffect, useRef } from 'react';
import type { FlightNetworkDataset, SimulationResult } from '../engine/types.js';
import { SceneBuffers } from './arcBuffers.js';
import { renderFlightScene } from './drawLayers.js';
import { MapCamera } from './projection.js';
import { useCanvasPointer } from './useCanvasPointer.js';

export const MIN_CLOCK_MIN = 360;
export const MAX_CLOCK_MIN = 1410;

export interface FlightCanvasProps {
  dataset: FlightNetworkDataset;
  simulation: SimulationResult;
  previewSimulation: SimulationResult | null;
  currentTimeMin: number;
  isPlaying: boolean;
  speed: 1 | 2 | 5;
  is3D: boolean;
  theme: 'night' | 'day';
  reducedMotion: boolean;
  selectedFlightId: string | null;
  selectedTailId: string | null;
  selectedAirportId: string | null;
  rightPanelInsetPx?: number;
  onAdvanceClock: (nextTimeMin: number, reachedEnd?: boolean) => void;
  onSelectFlight: (flightId: string) => void;
  onSelectAirport: (airportId: string) => void;
  onClearSelection: () => void;
  onCanvasError: () => void;
}

/**
 * Full-viewport HTML5 Canvas 2D interactive flight disruption map of India
 * with perspective 2D/3D projection, smooth 60fps clock interpolation, and ring-buffered trails.
 */
export function FlightCanvas(props: FlightCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const cameraRef = useRef<MapCamera | null>(null);
  const buffersRef = useRef<SceneBuffers | null>(null);

  const propsRef = useRef<FlightCanvasProps>(props);
  propsRef.current = props;

  const animClockRef = useRef<number>(props.currentTimeMin);
  const lastReportedClockRef = useRef<number>(props.currentTimeMin);
  const lastDispatchMsRef = useRef<number>(0);
  const lastFrameMsRef = useRef<number>(0);
  const pulseStartMsRef = useRef<number>(0);
  const rafIdRef = useRef<number | null>(null);
  const errorReportedRef = useRef<boolean>(false);
  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 });
  const scheduleTickRef = useRef<() => void>(() => {});

  const pointer = useCanvasPointer({
    cameraRef,
    buffersRef,
    animClockRef,
    reducedMotion: props.reducedMotion,
    scheduleTick: () => scheduleTickRef.current(),
    onSelectFlight: props.onSelectFlight,
    onSelectAirport: props.onSelectAirport,
    onClearSelection: props.onClearSelection,
  });

  const hoverRef = pointer.hoverRef;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext('2d', { alpha: false });
    } catch {
      ctx = null;
    }
    if (!ctx) {
      if (!errorReportedRef.current) {
        errorReportedRef.current = true;
        propsRef.current.onCanvasError();
      }
      return;
    }

    ctxRef.current = ctx;
    if (!cameraRef.current) cameraRef.current = new MapCamera(propsRef.current.is3D);
    if (!buffersRef.current) buffersRef.current = new SceneBuffers();

    const updateSize = () => {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (
        sizeRef.current.width !== width ||
        sizeRef.current.height !== height ||
        sizeRef.current.dpr !== dpr
      ) {
        sizeRef.current = { width, height, dpr };
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      cameraRef.current?.setViewport(width, height, propsRef.current.rightPanelInsetPx ?? 0);
    };

    const stopLoop = () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };

    const runFrame = (nowMs: number) => {
      rafIdRef.current = null;
      if (document.hidden) return;

      const curCtx = ctxRef.current;
      const camera = cameraRef.current;
      const buffers = buffersRef.current;
      if (!curCtx || !camera || !buffers) return;

      const p = propsRef.current;
      if (lastFrameMsRef.current === 0) lastFrameMsRef.current = nowMs;
      if (pulseStartMsRef.current === 0) pulseStartMsRef.current = nowMs;

      const dtSec = Math.min(0.1, Math.max(0.001, (nowMs - lastFrameMsRef.current) / 1000));
      lastFrameMsRef.current = nowMs;
      const camActive = camera.step(dtSec);

      if (p.isPlaying) {
        const rateMinPerSec = p.speed === 5 ? 50 : p.speed === 2 ? 20 : 10;
        const nextClock = Math.min(MAX_CLOCK_MIN, animClockRef.current + dtSec * rateMinPerSec);
        animClockRef.current = nextClock;

        if (nextClock >= MAX_CLOCK_MIN) {
          lastReportedClockRef.current = MAX_CLOCK_MIN;
          lastDispatchMsRef.current = nowMs;
          p.onAdvanceClock(MAX_CLOCK_MIN, true);
        } else {
          const rounded = Math.round(nextClock);
          if (nowMs - lastDispatchMsRef.current >= 95 && rounded !== lastReportedClockRef.current) {
            lastReportedClockRef.current = rounded;
            lastDispatchMsRef.current = nowMs;
            p.onAdvanceClock(rounded, false);
          }
        }
      }

      const simChanged = buffers.sync(
        p.dataset,
        p.simulation,
        p.previewSimulation,
        p.selectedFlightId,
        p.selectedTailId,
        p.selectedAirportId
      );
      buffers.updateTrailsAndFlightState(animClockRef.current, simChanged);

      const { width, height, dpr } = sizeRef.current;
      if (width > 0 && height > 0) {
        curCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        renderFlightScene(curCtx, camera, buffers, p.previewSimulation ?? p.simulation, {
          width,
          height,
          theme: p.theme,
          currentTimeMin: animClockRef.current,
          pulseTimeSec: p.reducedMotion ? 0 : (nowMs - pulseStartMsRef.current) / 1000,
          reducedMotion: p.reducedMotion,
          isPreviewActive: p.previewSimulation !== null,
          selectedFlightId: p.selectedFlightId,
          selectedAirportId: p.selectedAirportId,
          hoveredFlightId: hoverRef.current.flightId,
          hoveredAirportId: hoverRef.current.airportId,
        });
      }

      if ((!p.reducedMotion || p.isPlaying || camActive) && !document.hidden) {
        rafIdRef.current = requestAnimationFrame(runFrame);
      }
    };

    const scheduleTick = () => {
      if (document.hidden || rafIdRef.current !== null) return;
      rafIdRef.current = requestAnimationFrame(runFrame);
    };
    scheduleTickRef.current = scheduleTick;

    const handleVisibility = () => {
      if (document.hidden) {
        stopLoop();
      } else {
        lastFrameMsRef.current = performance.now();
        scheduleTick();
      }
    };

    updateSize();
    const ro = new ResizeObserver(() => {
      updateSize();
      scheduleTick();
    });
    ro.observe(canvas);
    document.addEventListener('visibilitychange', handleVisibility);
    scheduleTick();

    return () => {
      stopLoop();
      ro.disconnect();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [hoverRef]);

  useEffect(() => {
    const camera = cameraRef.current;
    if (camera) {
      camera.setIs3D(props.is3D, props.reducedMotion);
      if (sizeRef.current.width > 0) {
        camera.setViewport(
          sizeRef.current.width,
          sizeRef.current.height,
          props.rightPanelInsetPx ?? 0
        );
      }
    }

    if (
      !props.isPlaying ||
      (props.currentTimeMin !== lastReportedClockRef.current &&
        Math.abs(props.currentTimeMin - animClockRef.current) > 2.2)
    ) {
      animClockRef.current = props.currentTimeMin;
      lastReportedClockRef.current = props.currentTimeMin;
    }

    if (props.isPlaying) {
      lastFrameMsRef.current = performance.now();
    }
    scheduleTickRef.current();
  }, [
    props.dataset,
    props.simulation,
    props.previewSimulation,
    props.currentTimeMin,
    props.isPlaying,
    props.speed,
    props.is3D,
    props.theme,
    props.reducedMotion,
    props.selectedFlightId,
    props.selectedTailId,
    props.selectedAirportId,
    props.rightPanelInsetPx,
  ]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      onPointerDown={pointer.handlePointerDown}
      onPointerMove={pointer.handlePointerMove}
      onPointerUp={pointer.handlePointerUp}
      onPointerCancel={pointer.handlePointerUp}
      onPointerLeave={pointer.handlePointerLeave}
      onDoubleClick={pointer.handleDoubleClick}
      className="block h-full w-full touch-none select-none cursor-grab"
    />
  );
}

export default FlightCanvas;
