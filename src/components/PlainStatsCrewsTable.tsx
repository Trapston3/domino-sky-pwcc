import { useMemo } from 'react';
import type { SimulatedCrew } from '../engine/types.js';
import { getCrewBadgeMeta } from './statusStyles.js';

interface PlainStatsCrewsTableProps {
  crews: readonly SimulatedCrew[];
  crewBreaches: number;
  totalCrewOverageMin: number;
  onSelectFlight: (flightId: string) => void;
}

/** Crews FDTL table with 600-minute duty progress bars and clickable leg chips. */
export function PlainStatsCrewsTable({
  crews,
  crewBreaches,
  totalCrewOverageMin,
  onSelectFlight,
}: PlainStatsCrewsTableProps) {
  const maxDutyScale = useMemo(() => {
    const maxObserved = crews.reduce((max, c) => Math.max(max, c.dutyMin, c.maxDutyMins), 600);
    return Math.max(660, Math.ceil(maxObserved / 60) * 60);
  }, [crews]);

  return (
    <section id="section-crews" aria-label="Crew FDTL duty table" className="surface-panel rounded-xl p-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          Crews &amp; 600m Duty Limit ({crews.length})
        </h2>
        <span className="font-mono-tabular text-xs" style={{ color: 'var(--muted)' }}>
          {crewBreaches} breached · {totalCrewOverageMin}m overage
        </span>
      </div>

      <div className="overflow-x-auto max-h-[380px] overflow-y-auto rounded-lg border" style={{ borderColor: 'var(--border)' }}>
        <table className="w-full text-left border-collapse text-xs">
          <caption className="sr-only">
            Crew duty hours measured from duty start to actual arrival of final operated leg against 600-minute maximum duty limit
          </caption>
          <thead
            className="sticky top-0 z-10 border-b"
            style={{ backgroundColor: 'var(--panel-solid)', borderColor: 'var(--border)', color: 'var(--muted)' }}
          >
            <tr>
              <th scope="col" className="py-2 px-2.5 font-semibold">Crew</th>
              <th scope="col" className="py-2 px-2.5 font-semibold">Tail / Base</th>
              <th scope="col" className="py-2 px-2.5 font-semibold">Window</th>
              <th scope="col" className="py-2 px-2.5 font-semibold min-w-[160px]">600m Duty Bar</th>
              <th scope="col" className="py-2 px-2.5 font-semibold">Status</th>
              <th scope="col" className="py-2 px-2.5 font-semibold">Legs</th>
            </tr>
          </thead>
          <tbody>
            {crews.map((crew) => {
              const isIdle = crew.operatedFlightIds.length === 0;
              const fillPct = isIdle ? 0 : Math.min(100, (crew.dutyMin / maxDutyScale) * 100);
              const limitPct = Math.min(100, (crew.maxDutyMins / maxDutyScale) * 100);
              const barColor = crew.breached
                ? 'var(--breach)'
                : crew.maxDutyMins - crew.dutyMin <= 30
                  ? 'var(--delay)'
                  : 'var(--spare)';
              const badge = getCrewBadgeMeta(crew);

              return (
                <tr key={crew.crewId} className="border-b last:border-b-0 align-top" style={{ borderColor: 'var(--border)' }}>
                  <th scope="row" className="py-2 px-2.5 font-mono-tabular font-semibold whitespace-nowrap" style={{ color: 'var(--ink)' }}>
                    <div>{crew.crewId}</div>
                    {crew.isStandby && (
                      <span className="inline-block rounded px-1 py-0.5 text-[10px] font-medium" style={{ backgroundColor: 'var(--spare-bg)', color: 'var(--spare-text)' }}>
                        Standby
                      </span>
                    )}
                  </th>
                  <td className="py-2 px-2.5 font-mono-tabular whitespace-nowrap" style={{ color: 'var(--ink)' }}>
                    {crew.tailId} · {crew.base}
                  </td>
                  <td className="py-2 px-2.5 font-mono-tabular whitespace-nowrap" style={{ color: 'var(--muted)' }}>
                    {isIdle ? `${crew.dutyStartStr} (0 legs)` : `${crew.dutyStartStr}–${crew.lastArrStr}`}
                  </td>
                  <td className="py-2 px-2.5">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center justify-between font-mono-tabular text-[11px]">
                        <span style={{ color: crew.breached ? 'var(--breach-text)' : 'var(--ink)' }}>
                          {isIdle ? '0m' : `${crew.dutyMin}m`}
                        </span>
                        <span style={{ color: 'var(--muted)' }}>/ {crew.maxDutyMins}m</span>
                      </div>
                      <div
                        role="progressbar"
                        aria-valuenow={isIdle ? 0 : crew.dutyMin}
                        aria-valuemin={0}
                        aria-valuemax={crew.maxDutyMins}
                        aria-label={`${crew.crewId} duty ${isIdle ? 0 : crew.dutyMin} of ${crew.maxDutyMins} minutes`}
                        className="relative h-2.5 w-full rounded-full overflow-hidden"
                        style={{ backgroundColor: 'var(--track-bg)' }}
                      >
                        <div className="h-full rounded-full" style={{ width: `${fillPct}%`, backgroundColor: barColor }} />
                        <div
                          aria-hidden="true"
                          className="absolute top-0 bottom-0 w-0.5"
                          style={{ left: `${limitPct}%`, backgroundColor: 'var(--ink)' }}
                          title={`Max duty ${crew.maxDutyMins}m`}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="py-2 px-2.5 whitespace-nowrap">
                    <span
                      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium"
                      style={{ backgroundColor: badge.bg, color: badge.color, borderColor: badge.border }}
                    >
                      <span aria-hidden="true">{badge.icon}</span>
                      <span>{badge.label}</span>
                    </span>
                  </td>
                  <td className="py-2 px-2.5 font-mono-tabular text-[11px]">
                    {isIdle ? (
                      <span style={{ color: 'var(--muted)' }}>—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {crew.operatedFlightIds.map((fid) => {
                          const isBreachLeg = crew.breachedFlightIds.includes(fid);
                          return (
                            <button
                              key={`${crew.crewId}-${fid}`}
                              type="button"
                              onClick={() => onSelectFlight(fid)}
                              aria-label={`Inspect flight ${fid} operated by ${crew.crewId}`}
                              className="rounded px-1 py-0.5 cursor-pointer underline"
                              style={
                                isBreachLeg
                                  ? { backgroundColor: 'var(--breach-bg)', color: 'var(--breach-text)', fontWeight: 600 }
                                  : { backgroundColor: 'var(--panel-elevated)', color: 'var(--ink)' }
                              }
                            >
                              {isBreachLeg ? `! ${fid}` : fid}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
