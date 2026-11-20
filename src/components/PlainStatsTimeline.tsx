import { useMemo, useState } from 'react';
import { formatTimeMin } from '../engine/index.js';
import type { FlightNetworkDataset, SimulationResult } from '../engine/types.js';
import { FLIGHT_STATUS_META } from './statusStyles.js';
import { buildTimelineData } from './timelineData.js';

interface PlainStatsTimelineProps {
  dataset: FlightNetworkDataset;
  result: SimulationResult;
  onSelectFlight: (flightId: string) => void;
}

/** Tail-Chain CSS timeline across all base tails and active spares. */
export function PlainStatsTimeline({
  dataset,
  result,
  onSelectFlight,
}: PlainStatsTimelineProps) {
  const [selectedTimelineFlightId, setSelectedTimelineFlightId] = useState<string | null>(null);
  const timelineData = useMemo(() => buildTimelineData(dataset, result.flights), [dataset, result.flights]);
  const selectedFlight = useMemo(
    () => result.flights.find((f) => f.flight_id === selectedTimelineFlightId) ?? null,
    [result.flights, selectedTimelineFlightId],
  );

  return (
    <section id="section-tail-chains" aria-label="Tail chain operational timeline" className="surface-panel rounded-xl p-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
            Tail-Chain CSS Timeline ({timelineData.allRows.length} tails)
          </h2>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            Dashed outlines mark original scheduled slots. Click any leg to inspect causeSteps or open Domino Trace.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          {(
            [
              ['on_time', '✓ On time'],
              ['minor_delay', '◔ Minor delay'],
              ['major_delay', '▲ Major delay'],
              ['recovered', '↺ Recovered / Spare'],
              ['cancelled', '✕ Cancelled'],
            ] as const
          ).map(([statusKey, text]) => {
            const meta = FLIGHT_STATUS_META[statusKey];
            return (
              <span key={statusKey} className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5" style={{ backgroundColor: meta.bg, borderColor: meta.border, color: meta.color }}>
                {text}
              </span>
            );
          })}
        </div>
      </div>

      {timelineData.inactiveSpares.length > 0 && (
        <p className="font-mono-tabular text-xs" style={{ color: 'var(--muted)' }}>
          Standby spares on ground:{' '}
          {timelineData.inactiveSpares.map((s) => `${s.tail_id} (${s.base} from ${s.available_from})`).join(' · ')}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border p-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--panel-solid)' }}>
        <div className="min-w-[760px] flex flex-col gap-1.5">
          <div className="flex items-center gap-2 pb-1 border-b" style={{ borderColor: 'var(--border)' }}>
            <div className="w-28 shrink-0 font-mono-tabular text-[11px] font-semibold" style={{ color: 'var(--muted)' }}>Tail</div>
            <div className="relative flex-1 h-5">
              {timelineData.hourTicks.map((tickMin) => (
                <span
                  key={tickMin}
                  className="font-mono-tabular absolute -translate-x-1/2 text-[10px]"
                  style={{ left: `${((tickMin - timelineData.timelineStart) / timelineData.totalSpan) * 100}%`, color: 'var(--muted)' }}
                >
                  {formatTimeMin(tickMin)}
                </span>
              ))}
            </div>
          </div>

          <div className="relative flex flex-col gap-1.5">
            {result.closure && (() => {
              const cStart = Math.max(timelineData.timelineStart, Math.min(timelineData.timelineEnd, result.closure.startMin));
              const cEnd = Math.max(cStart, Math.min(timelineData.timelineEnd, result.closure.endMin));
              if (cEnd <= cStart) return null;
              return (
                <div aria-hidden="true" className="pointer-events-none absolute top-0 bottom-0 left-30 right-0 z-0">
                  <div
                    className="absolute top-0 bottom-0 border-x border-dashed"
                    style={{
                      left: `${((cStart - timelineData.timelineStart) / timelineData.totalSpan) * 100}%`,
                      width: `${((cEnd - cStart) / timelineData.totalSpan) * 100}%`,
                      backgroundColor: 'var(--storm-bg)',
                      borderColor: 'var(--storm)',
                    }}
                  >
                    <span className="font-mono-tabular inline-block whitespace-nowrap rounded-b px-1 py-0.5 text-[9px] font-semibold" style={{ backgroundColor: 'var(--storm)', color: 'var(--bg)' }}>
                      ⚡ {result.closure.airport} CLOSED
                    </span>
                  </div>
                </div>
              );
            })()}

            {timelineData.allRows.map((row) => {
              const rowData = timelineData.flightsByRow.get(row.tailId);
              const legs = rowData?.operatedOrCancelled ?? [];
              const handedOff = rowData?.handedOff ?? [];

              return (
                <div key={row.tailId} className="flex items-center gap-2">
                  <div className="w-28 shrink-0 flex flex-col">
                    <span className="font-mono-tabular text-xs font-semibold" style={{ color: row.isSpare ? 'var(--spare-text)' : 'var(--ink)' }}>
                      {row.isSpare ? `↺ ${row.tailId}` : row.tailId}
                    </span>
                    <span className="font-mono-tabular text-[10px]" style={{ color: 'var(--muted)' }}>
                      {row.isSpare ? 'Active spare' : `${legs.filter((l) => !l.cancelled).length} operated`}
                    </span>
                  </div>

                  <div className="relative flex-1 h-9 rounded-md border overflow-hidden" style={{ backgroundColor: 'var(--track-bg)', borderColor: 'var(--border)' }}>
                    {timelineData.hourTicks.map((tickMin) => (
                      <div
                        key={`${row.tailId}-grid-${tickMin}`}
                        aria-hidden="true"
                        className="absolute top-0 bottom-0 w-px opacity-35"
                        style={{ left: `${((tickMin - timelineData.timelineStart) / timelineData.totalSpan) * 100}%`, backgroundColor: 'var(--border)' }}
                      />
                    ))}

                    {handedOff.map((f) => (
                      <div
                        key={`${f.flight_id}-handoff`}
                        aria-hidden="true"
                        title={`${f.flight_id} transferred to ${f.operatingTail}`}
                        className="font-mono-tabular absolute top-1.5 bottom-1.5 rounded border border-dashed flex items-center justify-center text-[10px] opacity-75 px-1 truncate"
                        style={{
                          left: `${((f.schedDepMin - timelineData.timelineStart) / timelineData.totalSpan) * 100}%`,
                          width: `${Math.max(2, ((f.schedArrMin - f.schedDepMin) / timelineData.totalSpan) * 100)}%`,
                          borderColor: 'var(--spare)',
                          color: 'var(--spare-text)',
                        }}
                      >
                        → {f.operatingTail}
                      </div>
                    ))}

                    {legs.map((f) =>
                      f.cancelled || f.delayMin <= 0 ? null : (
                        <div
                          key={`${f.flight_id}-ghost`}
                          aria-hidden="true"
                          className="absolute top-2 bottom-2 rounded border border-dashed opacity-45"
                          style={{
                            left: `${((f.schedDepMin - timelineData.timelineStart) / timelineData.totalSpan) * 100}%`,
                            width: `${Math.max(1.5, ((f.schedArrMin - f.schedDepMin) / timelineData.totalSpan) * 100)}%`,
                            borderColor: 'var(--muted)',
                          }}
                        />
                      ),
                    )}

                    {legs.map((f) => {
                      const startMin = f.cancelled ? f.schedDepMin : f.actualDepMin;
                      const endMin = f.cancelled ? f.schedArrMin : f.actualArrMin;
                      const meta = FLIGHT_STATUS_META[f.status];
                      const isSelected = selectedTimelineFlightId === f.flight_id;

                      return (
                        <button
                          key={f.flight_id}
                          type="button"
                          onClick={() => setSelectedTimelineFlightId((prev) => (prev === f.flight_id ? null : f.flight_id))}
                          aria-pressed={isSelected}
                          aria-label={`${f.flight_id} ${f.origin} to ${f.destination}, ${f.cancelled ? 'cancelled' : `actual ${f.actualDepStr} to ${f.actualArrStr}, delay +${f.delayMin}m`}${f.crewBreachLeg ? ', crew duty breach' : ''}`}
                          className="font-mono-tabular absolute top-1 bottom-1 rounded border px-1 flex items-center justify-between gap-0.5 text-[10px] font-medium overflow-hidden cursor-pointer"
                          style={{
                            left: `${((startMin - timelineData.timelineStart) / timelineData.totalSpan) * 100}%`,
                            width: `${Math.max(2.2, ((endMin - startMin) / timelineData.totalSpan) * 100)}%`,
                            backgroundColor: isSelected ? 'var(--pill-active-bg)' : meta.bg,
                            color: isSelected ? 'var(--pill-active-ink)' : meta.color,
                            borderColor: f.crewBreachLeg ? 'var(--breach)' : meta.border,
                            borderStyle: f.cancelled ? 'dashed' : 'solid',
                            borderWidth: f.crewBreachLeg || isSelected ? '2px' : '1px',
                            textDecoration: f.cancelled ? 'line-through' : 'none',
                          }}
                        >
                          <span className="truncate">{meta.icon} {f.flight_id.replace('DS', '')}</span>
                          {f.crewBreachLeg && <span aria-hidden="true">!</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {selectedFlight && (
        <div className="surface-elevated rounded-lg p-3 flex flex-col gap-1.5 text-xs" aria-label={`Selected leg details for ${selectedFlight.flight_id}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono-tabular font-semibold" style={{ color: 'var(--ink)' }}>
                {selectedFlight.flight_id} ({selectedFlight.origin} → {selectedFlight.destination})
              </span>
              <span className="font-mono-tabular" style={{ color: 'var(--muted)' }}>
                Tail {selectedFlight.operatingTail} · Crew {selectedFlight.crewId} · {selectedFlight.pax} pax
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onSelectFlight(selectedFlight.flight_id)}
                aria-label={`Open full Domino Trace for ${selectedFlight.flight_id}`}
                className="rounded border px-2 py-0.5 text-xs font-medium cursor-pointer"
                style={{ borderColor: 'var(--storm)', backgroundColor: 'var(--storm-bg)', color: 'var(--storm-text)' }}
              >
                Open Domino Trace
              </button>
              <button
                type="button"
                onClick={() => setSelectedTimelineFlightId(null)}
                aria-label="Close selected flight details"
                className="font-mono-tabular rounded px-2 py-0.5 text-xs cursor-pointer"
                style={{ color: 'var(--muted)' }}
              >
                Close ✕
              </button>
            </div>
          </div>
          <div className="font-mono-tabular" style={{ color: 'var(--ink)' }}>
            Sched {selectedFlight.dep}–{selectedFlight.arr} ·{' '}
            {selectedFlight.cancelled
              ? 'Cancelled by recovery action'
              : `Actual ${selectedFlight.actualDepStr}–${selectedFlight.actualArrStr} (+${selectedFlight.delayMin}m) · Turnaround slack: ${selectedFlight.turnaroundSlackMin}m`}
          </div>
          {selectedFlight.causeSteps.length > 0 && (
            <p style={{ color: 'var(--ink)' }}>
              <strong>Why late:</strong> {selectedFlight.causeSteps.join(' → ')}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
