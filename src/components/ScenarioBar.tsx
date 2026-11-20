import { useEffect, useState } from 'react';
import { formatTimeMin, isValidHHMM, parseTimeMin } from '../engine/index.js';
import type { Airport, ClosureSpec, ReopeningSurge } from '../engine/types.js';
import {
  DURATION_OPTIONS,
  SCENARIO_PRESETS,
  closuresEqual,
  findMatchingPreset,
  getClosureDurationMin,
} from '../scenarios.js';

export type ThemeMode = 'night' | 'day';

interface ScenarioBarProps {
  airports: readonly Airport[];
  closure: ClosureSpec | null;
  surge: ReopeningSurge | null;
  theme: ThemeMode;
  onSelectClosure: (closure: ClosureSpec | null, label?: string) => void;
  onToggleTheme: () => void;
}

const MAX_MINUTE_IN_DAY = 23 * 60 + 59;

function SurgeStatusBadge({ surge }: { surge: ReopeningSurge | null }) {
  if (!surge) {
    return (
      <div
        className="surface-elevated inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs"
        title="Informational reopening surge: movements touching the closed airport in the 60 min after reopening divided by hourly capacity. Does not alter delay math."
      >
        <span aria-hidden="true" className="font-mono-tabular">
          ○
        </span>
        <span style={{ color: 'var(--muted)' }}>Reopening surge:</span>
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
      className="inline-flex flex-wrap items-center gap-2 rounded-full border px-3 py-1.5 text-xs"
      style={{ backgroundColor: bgStyle, borderColor }}
      title="Informational reopening surge: movements touching the closed airport in the 60 min after reopening divided by hourly capacity. Never alters delay math."
    >
      <span aria-hidden="true" style={{ color: textColor }}>
        {statusIcon}
      </span>
      <span style={{ color: 'var(--ink)' }}>
        Reopening surge{' '}
        <span className="font-mono-tabular font-semibold">
          {surge.airport} {surge.windowStartStr}–{surge.windowEndStr}
        </span>
        :
      </span>
      <span className="font-mono-tabular font-semibold" style={{ color: textColor }}>
        {surge.movements}/{surge.capacityPerHour}/hr ({surge.percent}% · {statusLabel})
      </span>
    </div>
  );
}

export function ScenarioBar({
  airports,
  closure,
  surge,
  theme,
  onSelectClosure,
  onToggleTheme,
}: ScenarioBarProps) {
  const [lastCustom, setLastCustom] = useState<{ airport: string; start: string; duration: number }>({
    airport: airports[1]?.id ?? airports[0]?.id ?? 'BOM',
    start: '07:30',
    duration: 90,
  });
  const [startDraft, setStartDraft] = useState<string>(closure?.start ?? lastCustom.start);
  const [timeHint, setTimeHint] = useState<string | null>(null);

  useEffect(() => {
    if (closure) {
      const dur = getClosureDurationMin(closure) ?? 90;
      setLastCustom({ airport: closure.airport, start: closure.start, duration: dur });
      setStartDraft(closure.start);
      setTimeHint(null);
    }
  }, [closure]);

  const activePreset = findMatchingPreset(closure);
  const activeDuration = closure ? getClosureDurationMin(closure) : null;
  const effectiveStart = closure?.start ?? lastCustom.start;
  const effectiveDuration = activeDuration ?? lastCustom.duration;

  function applyCustom(nextAirport: string, nextStart: string, nextDuration: number) {
    if (!nextAirport) {
      setTimeHint(null);
      onSelectClosure(null, 'Clear skies');
      return;
    }
    if (!isValidHHMM(nextStart)) {
      setTimeHint('Use 24-hour HH:MM format (e.g. 07:30).');
      return;
    }
    const startMin = parseTimeMin(nextStart);
    const endMin = startMin + nextDuration;
    if (endMin > MAX_MINUTE_IN_DAY) {
      setTimeHint('Closure window must end by 23:59 IST.');
      return;
    }
    const nextEnd = formatTimeMin(endMin);
    setTimeHint(null);
    setLastCustom({ airport: nextAirport, start: nextStart, duration: nextDuration });
    onSelectClosure(
      { airport: nextAirport, start: nextStart, end: nextEnd },
      `${nextAirport} ${nextStart}–${nextEnd}`,
    );
  }

  function handleAirportChange(nextAirport: string) {
    if (!nextAirport) {
      setTimeHint(null);
      onSelectClosure(null, 'Clear skies');
      return;
    }
    const startToUse = isValidHHMM(startDraft) ? startDraft : effectiveStart;
    applyCustom(nextAirport, startToUse, effectiveDuration);
  }

  function handleStartChange(raw: string) {
    setStartDraft(raw);
    if (!isValidHHMM(raw)) {
      if (raw.length === 5) {
        setTimeHint('Enter a valid HH:MM time (00:00–23:59).');
      } else {
        setTimeHint(null);
      }
      return;
    }
    const airportToUse = closure?.airport ?? lastCustom.airport;
    applyCustom(airportToUse, raw, effectiveDuration);
  }

  function handleStartBlur() {
    if (!isValidHHMM(startDraft)) {
      setStartDraft(effectiveStart);
      setTimeHint(null);
    }
  }

  function handleDurationSelect(durationMin: number) {
    const airportToUse = closure?.airport ?? lastCustom.airport;
    const startToUse = isValidHHMM(startDraft) ? startDraft : effectiveStart;
    applyCustom(airportToUse, startToUse, durationMin);
  }

  return (
    <header className="surface-panel rounded-xl px-4 py-3.5 shadow-sm">
      <nav aria-label="Scenario and display controls" className="flex flex-col gap-3">
        {/* Top bar: Brand + Informational Surge + Display controls */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1
              className="font-display text-2xl sm:text-3xl font-semibold tracking-tight leading-none"
              style={{ color: 'var(--ink)' }}
            >
              Domino Sky
            </h1>
            <p className="text-xs sm:text-sm" style={{ color: 'var(--muted)' }}>
              Close one airport. Watch what falls over.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <SurgeStatusBadge surge={surge} />

            <button
              type="button"
              onClick={onToggleTheme}
              aria-pressed={theme === 'day'}
              aria-label={theme === 'night' ? 'Switch to Day theme' : 'Switch to Night theme'}
              className="surface-elevated inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer"
              style={{ color: 'var(--ink)' }}
            >
              <span aria-hidden="true">{theme === 'night' ? '☀' : '☾'}</span>
              <span>{theme === 'night' ? 'Night' : 'Day'}</span>
            </button>
          </div>
        </div>

        {/* Scenario presets + Custom closure controls */}
        <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-2.5 pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
          {/* 5 Scenario Presets */}
          <div
            role="group"
            aria-label="Scenario presets"
            className="flex flex-wrap items-center gap-1.5"
          >
            {SCENARIO_PRESETS.map((preset) => {
              const isActive =
                activePreset?.id === preset.id || closuresEqual(closure, preset.closure);
              const isClear = preset.closure === null;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => onSelectClosure(preset.closure, preset.label)}
                  aria-pressed={isActive}
                  aria-label={`Select scenario: ${preset.label} (${preset.shortLabel})`}
                  title={preset.description}
                  className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer"
                  style={
                    isActive
                      ? {
                          backgroundColor: 'var(--pill-active-bg)',
                          color: 'var(--pill-active-ink)',
                          borderColor: 'var(--pill-active-bg)',
                        }
                      : {
                          backgroundColor: 'var(--panel-elevated)',
                          color: 'var(--ink)',
                          borderColor: 'var(--border)',
                        }
                  }
                >
                  <span aria-hidden="true">{isActive ? '●' : isClear ? '☀' : '⚡'}</span>
                  <span>{preset.label}</span>
                  <span
                    className="font-mono-tabular text-[11px] opacity-80"
                    style={isActive ? { color: 'var(--pill-active-ink)' } : { color: 'var(--muted)' }}
                  >
                    {preset.shortLabel}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Custom Closure Controls */}
          <div
            role="group"
            aria-label="Custom closure parameters"
            className="flex flex-wrap items-center gap-2"
          >
            <label className="inline-flex items-center gap-1.5 text-xs">
              <span style={{ color: 'var(--muted)' }}>Airport</span>
              <select
                value={closure?.airport ?? ''}
                onChange={(e) => handleAirportChange(e.target.value)}
                aria-label="Custom closure airport"
                className="font-mono-tabular rounded-md border px-2 py-1 text-xs"
                style={{
                  backgroundColor: 'var(--panel-elevated)',
                  color: 'var(--ink)',
                  borderColor: 'var(--border)',
                }}
              >
                <option value="">None (Clear skies)</option>
                {airports.map((airport) => (
                  <option key={airport.id} value={airport.id}>
                    {airport.id} · {airport.city} ({airport.capacity_per_hour}/hr)
                  </option>
                ))}
              </select>
            </label>

            <label className="inline-flex items-center gap-1.5 text-xs">
              <span style={{ color: 'var(--muted)' }}>Start</span>
              <input
                type="text"
                inputMode="numeric"
                maxLength={5}
                value={startDraft}
                onChange={(e) => handleStartChange(e.target.value)}
                onBlur={handleStartBlur}
                placeholder="HH:MM"
                aria-label="Closure start time in 24-hour HH:MM IST"
                className="font-mono-tabular w-16 rounded-md border px-2 py-1 text-xs text-center"
                style={{
                  backgroundColor: 'var(--panel-elevated)',
                  color: 'var(--ink)',
                  borderColor: timeHint ? 'var(--breach)' : 'var(--border)',
                }}
              />
            </label>

            <div role="group" aria-label="Closure duration in minutes" className="inline-flex items-center gap-1">
              <span className="text-xs mr-0.5" style={{ color: 'var(--muted)' }}>
                Dur
              </span>
              {DURATION_OPTIONS.map((dur) => {
                const isDurActive = closure !== null && activeDuration === dur;
                return (
                  <button
                    key={dur}
                    type="button"
                    onClick={() => handleDurationSelect(dur)}
                    aria-pressed={isDurActive}
                    aria-label={`Set closure duration to ${dur} minutes`}
                    className="font-mono-tabular rounded-md border px-2 py-1 text-xs font-medium cursor-pointer"
                    style={
                      isDurActive
                        ? {
                            backgroundColor: 'var(--storm-bg)',
                            color: 'var(--storm-text)',
                            borderColor: 'var(--storm)',
                          }
                        : {
                            backgroundColor: 'var(--panel-elevated)',
                            color: 'var(--ink)',
                            borderColor: 'var(--border)',
                          }
                    }
                  >
                    {dur}m
                  </button>
                );
              })}
            </div>

            {closure ? (
              <span
                className="font-mono-tabular text-xs font-medium px-2 py-1 rounded-md border"
                style={{
                  backgroundColor: 'var(--storm-bg)',
                  color: 'var(--storm-text)',
                  borderColor: 'var(--storm)',
                }}
              >
                {closure.airport} {closure.start}–{closure.end} IST
              </span>
            ) : (
              <span className="font-mono-tabular text-xs" style={{ color: 'var(--muted)' }}>
                No closure active
              </span>
            )}
          </div>
        </div>

        {timeHint && (
          <p className="text-xs font-medium" style={{ color: 'var(--breach-text)' }} role="alert">
            ▲ {timeHint}
          </p>
        )}
      </nav>
    </header>
  );
}
