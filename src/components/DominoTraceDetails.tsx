import type { SimulatedConnection, SimulatedCrew } from '../engine/types.js';
import { getConnectionBadgeMeta } from './statusStyles.js';

interface ConnectionItemProps {
  conn: SimulatedConnection;
  selectedFlightId: string;
  onSelectFlight: (flightId: string) => void;
}

/** Single touching connection item inside DominoTraceFlightView. */
export function ConnectionItem({
  conn,
  selectedFlightId,
  onSelectFlight,
}: ConnectionItemProps) {
  const isInbound = conn.to_flight === selectedFlightId;
  const peerFlight = isInbound ? conn.from_flight : conn.to_flight;
  const badge = getConnectionBadgeMeta(conn);

  return (
    <li
      className="rounded-lg border px-2.5 py-1.5 text-xs flex flex-wrap items-center justify-between gap-2"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--panel-elevated)' }}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono-tabular font-semibold" style={{ color: 'var(--ink)' }}>
          {conn.connection_id}
        </span>
        <span style={{ color: 'var(--muted)' }}>{isInbound ? 'from' : 'to'}</span>
        <button
          type="button"
          onClick={() => onSelectFlight(peerFlight)}
          aria-label={`Jump to connected flight ${peerFlight}`}
          className="font-mono-tabular underline font-medium cursor-pointer"
          style={{ color: 'var(--ink)' }}
        >
          {peerFlight}
        </button>
        <span className="font-mono-tabular" style={{ color: 'var(--muted)' }}>
          at {conn.airport} · {conn.passengers} pax
        </span>
      </div>
      <span
        className="font-mono-tabular inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium"
        style={{ backgroundColor: badge.bg, color: badge.color, borderColor: badge.border }}
      >
        <span aria-hidden="true">{badge.icon}</span>
        <span>{badge.label}</span>
      </span>
    </li>
  );
}

/** Crew duty progress bar against the 600-minute FDTL limit. */
export function CrewDutyPanel({ crew }: { crew: SimulatedCrew }) {
  const isIdle = crew.operatedFlightIds.length === 0;
  const maxScale = Math.max(660, crew.dutyMin, crew.maxDutyMins);
  const fillPct = isIdle ? 0 : Math.min(100, (crew.dutyMin / maxScale) * 100);
  const limitPct = Math.min(100, (crew.maxDutyMins / maxScale) * 100);
  const barColor = crew.breached
    ? 'var(--breach)'
    : crew.maxDutyMins - crew.dutyMin <= 30
      ? 'var(--delay)'
      : 'var(--spare)';

  return (
    <div
      className="rounded-lg border p-2.5 flex flex-col gap-1.5 text-xs"
      style={{
        borderColor: crew.breached ? 'var(--breach)' : 'var(--border)',
        backgroundColor: 'var(--panel-elevated)',
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono-tabular font-semibold" style={{ color: 'var(--ink)' }}>
            Crew {crew.crewId}
          </span>
          {crew.isStandby && (
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-medium"
              style={{ backgroundColor: 'var(--spare-bg)', color: 'var(--spare-text)' }}
            >
              Standby
            </span>
          )}
          <span className="font-mono-tabular" style={{ color: 'var(--muted)' }}>
            {crew.base} · {isIdle ? '0 legs' : `${crew.dutyStartStr}–${crew.lastArrStr}`}
          </span>
        </div>

        <span
          className="font-mono-tabular font-semibold"
          style={{ color: crew.breached ? 'var(--breach-text)' : 'var(--ontime-text)' }}
        >
          {crew.breached
            ? `▲ BREACH +${crew.overageMin}m (${crew.dutyMin}/${crew.maxDutyMins}m)`
            : `✓ ${crew.dutyMin}/${crew.maxDutyMins}m`}
        </span>
      </div>

      <div
        role="progressbar"
        aria-valuenow={isIdle ? 0 : crew.dutyMin}
        aria-valuemin={0}
        aria-valuemax={crew.maxDutyMins}
        aria-label={`Crew ${crew.crewId} duty ${isIdle ? 0 : crew.dutyMin} of ${crew.maxDutyMins} minutes`}
        className="relative h-2.5 w-full rounded-full overflow-hidden"
        style={{ backgroundColor: 'var(--track-bg)' }}
      >
        <div className="h-full rounded-full" style={{ width: `${fillPct}%`, backgroundColor: barColor }} />
        <div
          aria-hidden="true"
          className="absolute top-0 bottom-0 w-0.5"
          style={{ left: `${limitPct}%`, backgroundColor: 'var(--ink)' }}
        />
      </div>
    </div>
  );
}
