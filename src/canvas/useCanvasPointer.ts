import { useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import type { SceneBuffers } from './arcBuffers.js';
import { hitTestScene } from './hitTest.js';
import type { MapCamera } from './projection.js';

export interface HoverState {
  flightId: string | null;
  airportId: string | null;
}

interface DragState {
  active: boolean;
  pointerId: number;
  lastX: number;
  lastY: number;
  movedDist: number;
}

interface UseCanvasPointerOptions {
  cameraRef: RefObject<MapCamera | null>;
  buffersRef: RefObject<SceneBuffers | null>;
  animClockRef: RefObject<number>;
  reducedMotion: boolean;
  scheduleTick: () => void;
  onSelectFlight: (flightId: string) => void;
  onSelectAirport: (airportId: string) => void;
  onClearSelection: () => void;
}

/**
 * Encapsulates pointer drag-to-tilt/yaw, hover hit-testing, click selection,
 * and double-click camera reset for FlightCanvas.
 */
export function useCanvasPointer(opts: UseCanvasPointerOptions) {
  const hoverRef = useRef<HoverState>({ flightId: null, airportId: null });
  const dragRef = useRef<DragState>({
    active: false,
    pointerId: -1,
    lastX: 0,
    lastY: 0,
    movedDist: 0,
  });

  function getLocalCoords(e: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLCanvasElement>): void {
    if (e.button !== 0) return;
    dragRef.current = {
      active: true,
      pointerId: e.pointerId,
      lastX: e.clientX,
      lastY: e.clientY,
      movedDist: 0,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.style.cursor = 'grabbing';
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLCanvasElement>): void {
    const drag = dragRef.current;
    const camera = opts.cameraRef.current;
    const buffers = opts.buffersRef.current;
    if (!camera || !buffers) return;

    if (drag.active && drag.pointerId === e.pointerId) {
      const dx = e.clientX - drag.lastX;
      const dy = e.clientY - drag.lastY;
      drag.movedDist += Math.hypot(dx, dy);
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;
      if (drag.movedDist > 4) {
        camera.applyDragDelta(dx, dy);
        opts.scheduleTick();
      }
      return;
    }

    const { x, y } = getLocalCoords(e);
    const hit = hitTestScene(x, y, camera, buffers, opts.animClockRef.current);
    const nextFlightId = hit?.kind === 'flight' ? hit.flightId : null;
    const nextAirportId = hit?.kind === 'airport' ? hit.airportId : null;

    if (
      hoverRef.current.flightId !== nextFlightId ||
      hoverRef.current.airportId !== nextAirportId
    ) {
      hoverRef.current = { flightId: nextFlightId, airportId: nextAirportId };
      e.currentTarget.style.cursor = hit ? 'pointer' : 'grab';
      opts.scheduleTick();
    }
  }

  function handlePointerUp(e: ReactPointerEvent<HTMLCanvasElement>): void {
    const drag = dragRef.current;
    if (!drag.active || drag.pointerId !== e.pointerId) return;
    drag.active = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }

    const camera = opts.cameraRef.current;
    const buffers = opts.buffersRef.current;
    if (!camera || !buffers) return;

    if (drag.movedDist <= 5) {
      const { x, y } = getLocalCoords(e);
      const hit = hitTestScene(x, y, camera, buffers, opts.animClockRef.current);
      if (hit?.kind === 'flight') {
        opts.onSelectFlight(hit.flightId);
      } else if (hit?.kind === 'airport') {
        opts.onSelectAirport(hit.airportId);
      } else {
        opts.onClearSelection();
      }
      e.currentTarget.style.cursor = hit ? 'pointer' : 'grab';
    } else {
      e.currentTarget.style.cursor = 'grab';
    }
  }

  function handlePointerLeave(e: ReactPointerEvent<HTMLCanvasElement>): void {
    if (hoverRef.current.flightId !== null || hoverRef.current.airportId !== null) {
      hoverRef.current = { flightId: null, airportId: null };
      opts.scheduleTick();
    }
    if (!dragRef.current.active) {
      e.currentTarget.style.cursor = 'grab';
    }
  }

  function handleDoubleClick(): void {
    const camera = opts.cameraRef.current;
    if (!camera) return;
    camera.resetDrag(opts.reducedMotion);
    opts.scheduleTick();
  }

  return {
    hoverRef,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerLeave,
    handleDoubleClick,
  };
}
