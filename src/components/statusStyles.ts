import type {
  FlightVisualStatus,
  SimulatedConnection,
  SimulatedCrew,
} from '../engine/types.js';

export interface StatusToneMeta {
  icon: string;
  label: string;
  color: string;
  bg: string;
  border: string;
}

export const FLIGHT_STATUS_META: Record<FlightVisualStatus, StatusToneMeta> = {
  on_time: {
    icon: '✓',
    label: 'On time',
    color: 'var(--ontime-text)',
    bg: 'var(--ontime-bg)',
    border: 'var(--ontime)',
  },
  minor_delay: {
    icon: '◔',
    label: 'Minor delay',
    color: 'var(--delay-text)',
    bg: 'var(--delay-bg)',
    border: 'var(--delay)',
  },
  major_delay: {
    icon: '▲',
    label: 'Major delay',
    color: 'var(--breach-text)',
    bg: 'var(--breach-bg)',
    border: 'var(--breach)',
  },
  recovered: {
    icon: '↺',
    label: 'Recovered',
    color: 'var(--spare-text)',
    bg: 'var(--spare-bg)',
    border: 'var(--spare)',
  },
  cancelled: {
    icon: '✕',
    label: 'Cancelled',
    color: 'var(--muted)',
    bg: 'var(--panel-elevated)',
    border: 'var(--border)',
  },
};

export function getConnectionBadgeMeta(conn: SimulatedConnection): StatusToneMeta {
  if (conn.status === 'broken') {
    return {
      icon: '✕',
      label: `Broken (-${conn.shortfallMin}m)`,
      color: 'var(--breach-text)',
      bg: 'var(--breach-bg)',
      border: 'var(--breach)',
    };
  }
  if (conn.status === 'cancelled') {
    return {
      icon: '—',
      label: 'Cancelled',
      color: 'var(--muted)',
      bg: 'var(--panel-elevated)',
      border: 'var(--border)',
    };
  }
  if (conn.held) {
    return {
      icon: '⚑',
      label: `Held · Made (+${conn.slackMin}m)`,
      color: 'var(--spare-text)',
      bg: 'var(--spare-bg)',
      border: 'var(--spare)',
    };
  }
  return {
    icon: '✓',
    label: `Made (+${conn.slackMin}m)`,
    color: 'var(--ontime-text)',
    bg: 'var(--ontime-bg)',
    border: 'var(--ontime)',
  };
}

export function getCrewBadgeMeta(crew: SimulatedCrew): StatusToneMeta {
  if (crew.operatedFlightIds.length === 0) {
    return {
      icon: '—',
      label: 'Relieved',
      color: 'var(--muted)',
      bg: 'var(--panel-elevated)',
      border: 'var(--border)',
    };
  }
  if (crew.breached) {
    return {
      icon: '▲',
      label: `Breach +${crew.overageMin}m`,
      color: 'var(--breach-text)',
      bg: 'var(--breach-bg)',
      border: 'var(--breach)',
    };
  }
  if (crew.maxDutyMins - crew.dutyMin <= 30) {
    return {
      icon: '◔',
      label: 'Near limit',
      color: 'var(--delay-text)',
      bg: 'var(--delay-bg)',
      border: 'var(--delay)',
    };
  }
  return {
    icon: '✓',
    label: 'Legal',
    color: 'var(--ontime-text)',
    bg: 'var(--ontime-bg)',
    border: 'var(--ontime)',
  };
}

export function formatSignedDelta(delta: number, unit = ''): { text: string; color: string } {
  if (delta === 0) return { text: `0${unit}`, color: 'var(--muted)' };
  if (delta < 0) return { text: `↓ ${delta}${unit}`, color: 'var(--spare-text)' };
  return { text: `↑ +${delta}${unit}`, color: 'var(--breach-text)' };
}
