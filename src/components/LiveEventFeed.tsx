import { useMemo } from 'react';
import { formatTimeMin } from '../engine/index.js';
import type { FlightNetworkDataset, SimulationResult } from '../engine/types.js';
import { buildTimelineEvents, type EventSeverity } from './eventFeedBuilder.js';

interface LiveEventFeedProps {
  dataset: FlightNetworkDataset;
  simulation: SimulationResult;
  currentTimeMin: number;
  onSelectFlight: (flightId: string) => void;
  onSelectAirport: (airportId: string) => void;
}

const SEVERITY_STYLE: Record<
  EventSeverity,
  { icon: string; color: string; bg: string; border: string }
> = {
  storm: { icon: '⚡', color: 'var(--storm-text)', bg: 'var(--storm-bg)', border: 'var(--storm)' },
  breach: { icon: '▲', color: 'var(--breach-text)', bg: 'var(--breach-bg)', border: 'var(--breach)' },
  delay: { icon: '◔', color: 'var(--delay-text)', bg: 'var(--delay-bg)', border: 'var(--delay)' },
  spare: { icon: '↺', color: 'var(--spare-text)', bg: 'var(--spare-bg)', border: 'var(--spare)' },
  info: { icon: '✓', color: 'var(--ontime-text)', bg: 'var(--ontime-bg)', border: 'var(--ontime)' },
};

/** Live chronological "What is happening" event feed synced to the simulation clock. */
export function LiveEventFeed({
  dataset,
  simulation,
  currentTimeMin,
  onSelectFlight,
  onSelectAirport,
}: LiveEventFeedProps) {
  const allEvents = useMemo(
    () => buildTimelineEvents(dataset, simulation),
    [dataset, simulation],
  );

  const nowRounded = Math.floor(currentTimeMin);
  const pastAndCurrent = useMemo(
    () => allEvents.filter((e) => e.timeMin <= nowRounded).slice(-8).reverse(),
    [allEvents, nowRounded],
  );
  const upcoming = useMemo(
    () => allEvents.filter((e) => e.timeMin > nowRounded).slice(0, 3),
    [allEvents, nowRounded],
  );

  const activeAirborneCount = useMemo(
    () =>
      simulation.flights.filter(
        (f) => !f.cancelled && f.actualDepMin <= currentTimeMin && f.actualArrMin >= currentTimeMin,
      ).length,
    [simulation.flights, currentTimeMin],
  );

  return (
    <section
      aria-label="What is happening live event feed"
      className="surface-panel rounded-xl p-3 flex flex-col gap-2"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
          What is happening · {formatTimeMin(Math.round(currentTimeMin))}
        </h2>
        <span className="font-mono-tabular text-[11px]" style={{ color: 'var(--ink)' }}>
          {activeAirborneCount} airborne
        </span>
      </div>

      <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto pr-0.5">
        {pastAndCurrent.length === 0 ? (
          <p className="text-xs rounded-lg border px-2.5 py-2" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
            No events prior to {formatTimeMin(Math.round(currentTimeMin))} IST. Upcoming milestones below:
          </p>
        ) : (
          pastAndCurrent.map((ev) => {
            const tone = SEVERITY_STYLE[ev.severity];
            return (
              <div
                key={ev.id}
                className="rounded-lg border px-2.5 py-1.5 text-xs flex flex-col gap-1"
                style={{ backgroundColor: tone.bg, borderColor: tone.border }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-1.5 min-w-0">
                    <span aria-hidden="true" style={{ color: tone.color }}>
                      {tone.icon}
                    </span>
                    <span style={{ color: 'var(--ink)' }}>{ev.text}</span>
                  </div>
                  <span className="font-mono-tabular text-[10px] shrink-0" style={{ color: tone.color }}>
                    {ev.timeStr}
                  </span>
                </div>

                {(ev.flightId || ev.airportId) && (
                  <div className="flex flex-wrap gap-1.5 pl-4">
                    {ev.flightId && (
                      <button
                        type="button"
                        onClick={() => onSelectFlight(ev.flightId!)}
                        aria-label={`Inspect flight ${ev.flightId} domino trace`}
                        className="font-mono-tabular rounded border px-1.5 py-0.5 text-[10px] font-semibold cursor-pointer"
                        style={{ backgroundColor: 'var(--panel-solid)', color: 'var(--ink)', borderColor: 'var(--border)' }}
                      >
                        ✈ {ev.flightId}
                      </button>
                    )}
                    {ev.airportId && (
                      <button
                        type="button"
                        onClick={() => onSelectAirport(ev.airportId!)}
                        aria-label={`Inspect airport ${ev.airportId}`}
                        className="font-mono-tabular rounded border px-1.5 py-0.5 text-[10px] font-medium cursor-pointer"
                        style={{ backgroundColor: 'var(--panel-solid)', color: 'var(--muted)', borderColor: 'var(--border)' }}
                      >
                        ◎ {ev.airportId}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}

        {upcoming.length > 0 && (
          <div className="pt-1 flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
              Next up
            </span>
            {upcoming.map((ev) => (
              <div
                key={`up-${ev.id}`}
                className="rounded-md border border-dashed px-2 py-1 text-[11px] flex items-center justify-between gap-2"
                style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
              >
                <span className="truncate">{ev.text}</span>
                <div className="flex items-center gap-1 shrink-0">
                  {ev.flightId && (
                    <button
                      type="button"
                      onClick={() => onSelectFlight(ev.flightId!)}
                      aria-label={`Inspect upcoming flight ${ev.flightId}`}
                      className="font-mono-tabular underline cursor-pointer"
                      style={{ color: 'var(--ink)' }}
                    >
                      {ev.flightId}
                    </button>
                  )}
                  <span className="font-mono-tabular">{ev.timeStr}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
