import type { ReopeningSurge } from '../engine/types.js';

interface SurgeBadgeProps {
  surge: ReopeningSurge | null;
}

/** Informational reopening surge pill (movements in [end, end+60) / hourly capacity). */
export function SurgeBadge({ surge }: SurgeBadgeProps) {
  if (!surge) {
    return (
      <div
        className="surface-elevated inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px]"
        title="Informational reopening surge: movements touching the closed airport in the 60 min after reopening divided by hourly capacity. Does not alter delay math."
      >
        <span aria-hidden="true" className="font-mono-tabular">
          ○
        </span>
        <span style={{ color: 'var(--muted)' }}>Surge:</span>
        <span className="font-mono-tabular font-medium" style={{ color: 'var(--ontime-text)' }}>
          None (nominal)
        </span>
      </div>
    );
  }

  const isOver = surge.percent > 100;
  const isElevated = surge.percent >= 75 && !isOver;
  const statusIcon = isOver ? '▲' : isElevated ? '◔' : '✓';
  const statusLabel = isOver ? 'Over cap' : isElevated ? 'Elevated' : 'Within cap';
  const textColor = isOver
    ? 'var(--breach-text)'
    : isElevated
      ? 'var(--delay-text)'
      : 'var(--spare-text)';
  const bgStyle = isOver
    ? 'var(--breach-bg)'
    : isElevated
      ? 'var(--delay-bg)'
      : 'var(--spare-bg)';
  const borderColor = isOver ? 'var(--breach)' : isElevated ? 'var(--delay)' : 'var(--spare)';

  return (
    <div
      className="inline-flex flex-wrap items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]"
      style={{ backgroundColor: bgStyle, borderColor }}
      title="Informational reopening surge: movements touching the closed airport in the 60 min after reopening divided by hourly capacity. Never alters delay math."
    >
      <span aria-hidden="true" style={{ color: textColor }}>
        {statusIcon}
      </span>
      <span style={{ color: 'var(--ink)' }}>
        Surge{' '}
        <span className="font-mono-tabular font-semibold">
          {surge.airport} {surge.windowStartStr}–{surge.windowEndStr}
        </span>
      </span>
      <span className="font-mono-tabular font-semibold" style={{ color: textColor }}>
        {surge.movements}/{surge.capacityPerHour}/hr ({surge.percent}% · {statusLabel})
      </span>
    </div>
  );
}
