import { useEffect, useRef } from 'react';
import type { Airport, SimulatedFlight, SimulationResult } from '../engine/types.js';
import { FLIGHT_STATUS_META } from './statusStyles.js';

interface DominoTraceAirportViewProps {
  airport: Airport;
  simulation: SimulationResult;
  currentTimeMin: number;
  onSelectFlight: (flightId: string) => void;
  onClose: () => void;
}

function formatTier(tier: string): string {
  if (tier === 'mega_hub') return 'Mega hub';
  if (tier === 'regional_hub') return 'Regional hub';
  return 'Spoke';
}

/** Airport view inside DominoTraceCard showing closure surge, held flights, departures, and arrivals. */
export function DominoTraceAirportView({
  airport,
  simulation,
  currentTimeMin,
  onSelectFlight,
  onClose,
}: DominoTraceAirportViewProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, [airport.id]);

  const isClosedAirport = simulation.closure?.airport === airport.id;
  const departures = simulation.flights
    .filter((f) => f.origin === airport.id)
    .sort((a, b) => a.schedDepMin - b.schedDepMin);
  const arrivals = simulation.flights
    .filter((f) => f.destination === airport.id)
    .sort((a, b) => a.schedArrMin - b.schedArrMin);

  const heldAtClosure = simulation.flights.filter(
    (f) =>
      !f.cancelled &&
      f.closureDelayMin > 0 &&
      (f.origin === airport.id || f.destination === airport.id),
  );
  const activelyHeldNow = heldAtClosure.filter((f) =>
    f.origin === airport.id
      ? f.schedDepMin <= currentTimeMin && f.actualDepMin > currentTimeMin
      : f.schedArrMin <= currentTimeMin && f.actualArrMin > currentTimeMin,
  );

  const renderFlightChip = (f: SimulatedFlight) => {
    const tone = FLIGHT_STATUS_META[f.status];
    return (
      <button
        key={`${f.flight_id}-${f.origin}-${f.destination}`}
        type="button"
        onClick={() => onSelectFlight(f.flight_id)}
        aria-label={`Inspect flight ${f.flight_id} ${f.origin} to ${f.destination}`}
        className="font-mono-tabular inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] cursor-pointer"
        style={{ backgroundColor: tone.bg, borderColor: tone.border, color: tone.color }}
      >
        <span aria-hidden="true">{tone.icon}</span>
        <span className="font-semibold">{f.flight_id}</span>
        <span>
          {f.origin}→{f.destination}
        </span>
        <span>
          {f.cancelled ? 'Canc' : `${f.actualDepStr}${f.delayMin > 0 ? ` (+${f.delayMin}m)` : ''}`}
        </span>
      </button>
    );
  };

  return (
    <section
      role="region"
      aria-label={`Airport trace card for ${airport.id} ${airport.city}`}
      className="surface-panel rounded-xl p-3.5 shadow-xl flex flex-col gap-3 max-h-[52vh] overflow-y-auto"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
              Airport Trace
            </span>
            <span
              className="font-mono-tabular rounded border px-1.5 py-0.5 text-[10px]"
              style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
            >
              {formatTier(airport.tier)} · {airport.capacity_per_hour}/hr cap
            </span>
            {isClosedAirport && simulation.closure && (
              <span
                className="font-mono-tabular rounded border px-1.5 py-0.5 text-[10px] font-semibold"
                style={{ backgroundColor: 'var(--storm-bg)', borderColor: 'var(--storm)', color: 'var(--storm-text)' }}
              >
                ⚡ GROUND STOP {simulation.closure.start}–{simulation.closure.end}
              </span>
            )}
          </div>
          <h2 ref={headingRef} tabIndex={-1} className="text-base font-semibold mt-0.5" style={{ color: 'var(--ink)' }}>
            <span className="font-mono-tabular">{airport.id}</span> · {airport.city}
          </h2>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            {airport.name}
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close airport trace card"
          className="surface-elevated rounded-md px-2 py-1 text-xs font-medium cursor-pointer shrink-0"
          style={{ color: 'var(--ink)' }}
        >
          ✕ Close
        </button>
      </div>

      {isClosedAirport && simulation.surge && (
        <div
          className="rounded-lg border px-2.5 py-2 text-xs flex flex-wrap items-center justify-between gap-2"
          style={{ backgroundColor: 'var(--storm-bg)', borderColor: 'var(--storm)', color: 'var(--ink)' }}
        >
          <span>
            <strong>Reopening surge</strong> ({simulation.surge.windowStartStr}–{simulation.surge.windowEndStr}):
          </span>
          <span className="font-mono-tabular font-semibold" style={{ color: 'var(--storm-text)' }}>
            {simulation.surge.movements} movements / {simulation.surge.capacityPerHour}/hr ({simulation.surge.percent}%)
          </span>
        </div>
      )}

      {heldAtClosure.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--delay-text)' }}>
            Held by closure ({heldAtClosure.length} total · {activelyHeldNow.length} at current clock)
          </h3>
          <div className="flex flex-wrap gap-1.5">{heldAtClosure.map(renderFlightChip)}</div>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
          Departures ({departures.length})
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {departures.length === 0 ? (
            <span className="text-xs" style={{ color: 'var(--muted)' }}>
              None scheduled.
            </span>
          ) : (
            departures.map(renderFlightChip)
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
          Arrivals ({arrivals.length})
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {arrivals.length === 0 ? (
            <span className="text-xs" style={{ color: 'var(--muted)' }}>
              None scheduled.
            </span>
          ) : (
            arrivals.map(renderFlightChip)
          )}
        </div>
      </div>
    </section>
  );
}
