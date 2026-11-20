import type { SimulatedFlight, SimulationResult } from '../engine/types.js';
import { ConnectionItem, CrewDutyPanel } from './DominoTraceDetails.js';
import { FLIGHT_STATUS_META } from './statusStyles.js';

interface DominoTraceFlightViewProps {
  flight: SimulatedFlight;
  simulation: SimulationResult;
  onSelectFlight: (flightId: string) => void;
  onSelectAirport: (airportId: string) => void;
  onClose: () => void;
}

/** Flight and full tail-chain view inside DominoTraceCard. */
export function DominoTraceFlightView({
  flight,
  simulation,
  onSelectFlight,
  onSelectAirport,
  onClose,
}: DominoTraceFlightViewProps) {
  const activeTailId = flight.cancelled ? flight.tail_id : flight.operatingTail;
  const tailChain = simulation.flights
    .filter((f) => (f.cancelled ? f.tail_id === activeTailId : f.operatingTail === activeTailId))
    .sort((a, b) => a.leg_order - b.leg_order);
  const handedOffLegs = simulation.flights
    .filter((f) => !f.cancelled && f.tail_id === activeTailId && f.operatingTail !== activeTailId)
    .sort((a, b) => a.leg_order - b.leg_order);

  const touchingConnections = simulation.connections.filter(
    (c) => c.from_flight === flight.flight_id || c.to_flight === flight.flight_id,
  );
  const crew = simulation.crews.find((c) => c.crewId === flight.crewId) ?? null;
  const badge = FLIGHT_STATUS_META[flight.status];

  return (
    <section
      role="region"
      aria-label={`Domino Trace Card for flight ${flight.flight_id}`}
      className="surface-panel rounded-xl p-3.5 shadow-xl flex flex-col gap-3 max-h-[52vh] overflow-y-auto"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
              Domino Trace
            </span>
            <span
              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium"
              style={{ backgroundColor: badge.bg, color: badge.color, borderColor: badge.border }}
            >
              <span aria-hidden="true">{badge.icon}</span>
              <span>{badge.label}</span>
            </span>
            {flight.isSwapped && (
              <span
                className="font-mono-tabular rounded border px-1.5 py-0.5 text-[11px]"
                style={{ backgroundColor: 'var(--spare-bg)', color: 'var(--spare-text)', borderColor: 'var(--spare)' }}
              >
                ↺ Spare {flight.operatingTail} (was {flight.tail_id})
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="font-mono-tabular text-base font-semibold" style={{ color: 'var(--ink)' }}>
              {flight.flight_id}
            </h2>
            <div className="flex items-center gap-1 font-mono-tabular text-xs">
              <button
                type="button"
                onClick={() => onSelectAirport(flight.origin)}
                aria-label={`Inspect origin airport ${flight.origin}`}
                className="underline cursor-pointer"
                style={{ color: 'var(--ink)' }}
              >
                {flight.origin}
              </button>
              <span style={{ color: 'var(--muted)' }}>→</span>
              <button
                type="button"
                onClick={() => onSelectAirport(flight.destination)}
                aria-label={`Inspect destination airport ${flight.destination}`}
                className="underline cursor-pointer"
                style={{ color: 'var(--ink)' }}
              >
                {flight.destination}
              </button>
            </div>
            <span className="font-mono-tabular text-xs" style={{ color: 'var(--muted)' }}>
              Tail {activeTailId} · {flight.pax} pax
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close Domino Trace card"
          className="surface-elevated rounded-md px-2 py-1 text-xs font-medium cursor-pointer shrink-0"
          style={{ color: 'var(--ink)' }}
        >
          ✕ Close
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
        <div className="surface-elevated rounded-lg px-2.5 py-1.5">
          <div style={{ color: 'var(--muted)' }}>Scheduled</div>
          <div className="font-mono-tabular font-semibold" style={{ color: 'var(--ink)' }}>
            {flight.dep}–{flight.arr}
          </div>
        </div>
        <div className="surface-elevated rounded-lg px-2.5 py-1.5">
          <div style={{ color: 'var(--muted)' }}>Actual</div>
          <div className="font-mono-tabular font-semibold" style={{ color: badge.color }}>
            {flight.cancelled ? 'Cancelled' : `${flight.actualDepStr}–${flight.actualArrStr} (+${flight.delayMin}m)`}
          </div>
        </div>
        <div className="surface-elevated rounded-lg px-2.5 py-1.5 col-span-2 sm:col-span-1">
          <div style={{ color: 'var(--muted)' }}>Turnaround slack</div>
          <div className="font-mono-tabular font-semibold" style={{ color: 'var(--ink)' }}>
            {flight.cancelled ? '—' : `${flight.turnaroundSlackMin}m`}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
          Causal Cascade (Why late)
        </h3>
        {flight.causeSteps.length > 0 ? (
          <ol className="flex flex-col gap-1 text-xs">
            {flight.causeSteps.map((step, idx) => (
              <li
                key={`${flight.flight_id}-step-${idx}`}
                className="rounded-md border px-2.5 py-1.5"
                style={{ borderColor: 'var(--border)', backgroundColor: 'var(--panel-elevated)', color: 'var(--ink)' }}
              >
                <span className="font-mono-tabular font-semibold mr-1.5" style={{ color: badge.color }}>
                  {idx + 1}.
                </span>
                {step}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-xs rounded-md border px-2.5 py-1.5" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
            {flight.cancelled ? 'Cancelled by active recovery plan.' : 'On schedule — zero cascade delay.'}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
            Tail Chain · {activeTailId} ({tailChain.length} legs)
          </h3>
          {handedOffLegs.length > 0 && (
            <span className="font-mono-tabular text-[11px]" style={{ color: 'var(--spare-text)' }}>
              Handed to spare: {handedOffLegs.map((l) => `${l.flight_id}→${l.operatingTail}`).join(', ')}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-1">
          {tailChain.map((leg) => {
            const isCurrent = leg.flight_id === flight.flight_id;
            const legTone = FLIGHT_STATUS_META[leg.status];
            return (
              <button
                key={leg.flight_id}
                type="button"
                onClick={() => onSelectFlight(leg.flight_id)}
                aria-pressed={isCurrent}
                aria-label={`Inspect tail leg ${leg.leg_order}: ${leg.flight_id} ${leg.origin} to ${leg.destination}`}
                className="w-full text-left rounded-lg border px-2.5 py-1.5 text-xs flex flex-wrap items-center justify-between gap-2 cursor-pointer"
                style={
                  isCurrent
                    ? { backgroundColor: 'var(--storm-bg)', borderColor: 'var(--storm)', color: 'var(--ink)' }
                    : { backgroundColor: 'var(--panel-elevated)', borderColor: 'var(--border)', color: 'var(--ink)' }
                }
              >
                <div className="flex flex-wrap items-center gap-1.5 font-mono-tabular">
                  <span className="text-[11px]" style={{ color: 'var(--muted)' }}>L{leg.leg_order}</span>
                  <span className="font-semibold">{leg.flight_id}</span>
                  <span>{leg.origin}→{leg.destination}</span>
                  {leg.isSwapped && <span className="text-[10px]" style={{ color: 'var(--spare-text)' }}>↺ spare</span>}
                </div>
                <div className="flex flex-wrap items-center gap-2 font-mono-tabular text-[11px]">
                  <span style={{ color: 'var(--muted)' }}>sched {leg.dep}–{leg.arr}</span>
                  <span style={{ color: legTone.color }}>
                    {leg.cancelled
                      ? '✕ Cancelled'
                      : `${legTone.icon} ${leg.actualDepStr}–${leg.actualArrStr}${leg.delayMin > 0 ? ` (+${leg.delayMin}m)` : ''}`}
                  </span>
                  {!leg.cancelled && leg.turnaroundSlackMin > 0 && (
                    <span style={{ color: 'var(--muted)' }}>slack {leg.turnaroundSlackMin}m</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
          Connections ({touchingConnections.length})
        </h3>
        {touchingConnections.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--muted)' }}>No tracked connecting itineraries on this leg.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {touchingConnections.map((conn) => (
              <ConnectionItem
                key={conn.connection_id}
                conn={conn}
                selectedFlightId={flight.flight_id}
                onSelectFlight={onSelectFlight}
              />
            ))}
          </ul>
        )}
      </div>

      {crew && (
        <div className="flex flex-col gap-1">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
            Crew Duty Status
          </h3>
          <CrewDutyPanel crew={crew} />
        </div>
      )}
    </section>
  );
}
