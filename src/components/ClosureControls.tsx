import { useEffect, useState } from 'react';
import { formatTimeMin, isValidHHMM, parseTimeMin } from '../engine/index.js';
import type { Airport, ClosureSpec, SimulatedFlight } from '../engine/types.js';
import {
  DURATION_OPTIONS,
  SCENARIO_PRESETS,
  closuresEqual,
  findMatchingPreset,
  getClosureDurationMin,
} from '../scenarios.js';

interface ClosureControlsProps {
  airports: readonly Airport[];
  flights: readonly SimulatedFlight[];
  closure: ClosureSpec | null;
  selectedFlightId: string | null;
  selectedAirportId: string | null;
  onSelectClosure: (closure: ClosureSpec | null, label?: string) => void;
  onSelectFlight: (flightId: string) => void;
  onSelectAirport: (airportId: string) => void;
  onClearSelection: () => void;
  onTimeHintChange: (hint: string | null) => void;
}

const MAX_MINUTE_IN_DAY = 23 * 60 + 59;

/** Scenario preset pills, custom closure airport/start/duration inputs, and keyboard Inspect selector. */
export function ClosureControls({
  airports,
  flights,
  closure,
  selectedFlightId,
  selectedAirportId,
  onSelectClosure,
  onSelectFlight,
  onSelectAirport,
  onClearSelection,
  onTimeHintChange,
}: ClosureControlsProps) {
  const [lastCustom, setLastCustom] = useState<{ airport: string; start: string; duration: number }>({
    airport: airports[1]?.id ?? airports[0]?.id ?? 'BOM',
    start: '07:30',
    duration: 90,
  });
  const [startDraft, setStartDraft] = useState<string>(closure?.start ?? lastCustom.start);
  const [hasError, setHasError] = useState<boolean>(false);

  useEffect(() => {
    if (closure) {
      const dur = getClosureDurationMin(closure) ?? 90;
      setLastCustom({ airport: closure.airport, start: closure.start, duration: dur });
      setStartDraft(closure.start);
      setHasError(false);
      onTimeHintChange(null);
    }
  }, [closure, onTimeHintChange]);

  const activePreset = findMatchingPreset(closure);
  const activeDuration = closure ? getClosureDurationMin(closure) : null;
  const effectiveStart = closure?.start ?? lastCustom.start;
  const effectiveDuration = activeDuration ?? lastCustom.duration;

  const inspectValue = selectedFlightId
    ? `flight:${selectedFlightId}`
    : selectedAirportId
      ? `airport:${selectedAirportId}`
      : '';

  function applyCustom(nextAirport: string, nextStart: string, nextDuration: number) {
    if (!nextAirport) {
      setHasError(false);
      onTimeHintChange(null);
      onSelectClosure(null, 'Clear skies');
      return;
    }
    if (!isValidHHMM(nextStart)) {
      setHasError(true);
      onTimeHintChange('Use 24-hour HH:MM format (e.g. 07:30).');
      return;
    }
    const endMin = parseTimeMin(nextStart) + nextDuration;
    if (endMin > MAX_MINUTE_IN_DAY) {
      setHasError(true);
      onTimeHintChange('Closure window must end by 23:59 IST.');
      return;
    }
    const nextEnd = formatTimeMin(endMin);
    setHasError(false);
    onTimeHintChange(null);
    setLastCustom({ airport: nextAirport, start: nextStart, duration: nextDuration });
    onSelectClosure(
      { airport: nextAirport, start: nextStart, end: nextEnd },
      `${nextAirport} ${nextStart}–${nextEnd}`,
    );
  }

  function handleStartChange(raw: string) {
    setStartDraft(raw);
    if (!isValidHHMM(raw)) {
      const invalidFive = raw.length === 5;
      setHasError(invalidFive);
      onTimeHintChange(invalidFive ? 'Enter a valid HH:MM time (00:00–23:59).' : null);
      return;
    }
    applyCustom(closure?.airport ?? lastCustom.airport, raw, effectiveDuration);
  }

  function handleInspectChange(raw: string) {
    if (!raw) onClearSelection();
    else if (raw.startsWith('flight:')) onSelectFlight(raw.slice('flight:'.length));
    else if (raw.startsWith('airport:')) onSelectAirport(raw.slice('airport:'.length));
  }

  return (
    <div className="flex flex-col gap-2">
      <div role="group" aria-label="Scenario presets" className="flex flex-wrap items-center gap-1.5">
        {SCENARIO_PRESETS.map((preset) => {
          const isActive = activePreset?.id === preset.id || closuresEqual(closure, preset.closure);
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => onSelectClosure(preset.closure, preset.label)}
              aria-pressed={isActive}
              aria-label={`Select scenario: ${preset.label} (${preset.shortLabel})`}
              title={preset.description}
              className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors cursor-pointer"
              style={
                isActive
                  ? { backgroundColor: 'var(--pill-active-bg)', color: 'var(--pill-active-ink)', borderColor: 'var(--pill-active-bg)' }
                  : { backgroundColor: 'var(--panel-elevated)', color: 'var(--ink)', borderColor: 'var(--border)' }
              }
            >
              <span aria-hidden="true">{isActive ? '●' : preset.closure === null ? '☀' : '⚡'}</span>
              <span>{preset.label}</span>
              <span className="font-mono-tabular text-[10px] opacity-80 hidden md:inline" style={isActive ? { color: 'var(--pill-active-ink)' } : { color: 'var(--muted)' }}>
                {preset.shortLabel}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label="Custom closure parameters" className="flex flex-wrap items-center gap-1.5">
          <label className="inline-flex items-center gap-1 text-[11px]">
            <span style={{ color: 'var(--muted)' }}>Airport</span>
            <select
              value={closure?.airport ?? ''}
              onChange={(e) => applyCustom(e.target.value, isValidHHMM(startDraft) ? startDraft : effectiveStart, effectiveDuration)}
              aria-label="Custom closure airport"
              className="font-mono-tabular rounded-md border px-1.5 py-0.5 text-[11px]"
              style={{ backgroundColor: 'var(--panel-elevated)', color: 'var(--ink)', borderColor: 'var(--border)' }}
            >
              <option value="">None (Clear)</option>
              {airports.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.id} · {a.city} ({a.capacity_per_hour}/hr)
                </option>
              ))}
            </select>
          </label>

          <label className="inline-flex items-center gap-1 text-[11px]">
            <span style={{ color: 'var(--muted)' }}>Start</span>
            <input
              type="text"
              inputMode="numeric"
              maxLength={5}
              value={startDraft}
              onChange={(e) => handleStartChange(e.target.value)}
              onBlur={() => {
                if (!isValidHHMM(startDraft)) {
                  setStartDraft(effectiveStart);
                  setHasError(false);
                  onTimeHintChange(null);
                }
              }}
              placeholder="HH:MM"
              aria-label="Closure start time in 24-hour HH:MM IST"
              className="font-mono-tabular w-14 rounded-md border px-1.5 py-0.5 text-[11px] text-center"
              style={{ backgroundColor: 'var(--panel-elevated)', color: 'var(--ink)', borderColor: hasError ? 'var(--breach)' : 'var(--border)' }}
            />
          </label>

          <div role="group" aria-label="Closure duration in minutes" className="inline-flex items-center gap-1">
            {DURATION_OPTIONS.map((dur) => {
              const isDurActive = closure !== null && activeDuration === dur;
              return (
                <button
                  key={dur}
                  type="button"
                  onClick={() => applyCustom(closure?.airport ?? lastCustom.airport, isValidHHMM(startDraft) ? startDraft : effectiveStart, dur)}
                  aria-pressed={isDurActive}
                  aria-label={`Set closure duration to ${dur} minutes`}
                  className="font-mono-tabular rounded border px-1.5 py-0.5 text-[11px] font-medium cursor-pointer"
                  style={
                    isDurActive
                      ? { backgroundColor: 'var(--storm-bg)', color: 'var(--storm-text)', borderColor: 'var(--storm)' }
                      : { backgroundColor: 'var(--panel-elevated)', color: 'var(--ink)', borderColor: 'var(--border)' }
                  }
                >
                  {dur}m
                </button>
              );
            })}
          </div>

          {closure && (
            <span className="font-mono-tabular text-[11px] font-medium px-1.5 py-0.5 rounded border" style={{ backgroundColor: 'var(--storm-bg)', color: 'var(--storm-text)', borderColor: 'var(--storm)' }}>
              {closure.airport} {closure.start}–{closure.end}
            </span>
          )}
        </div>

        <label className="inline-flex items-center gap-1.5 text-[11px]">
          <span style={{ color: 'var(--muted)' }}>Inspect</span>
          <select
            value={inspectValue}
            onChange={(e) => handleInspectChange(e.target.value)}
            aria-label="Inspect any flight or airport Domino Trace"
            className="font-mono-tabular rounded-md border px-2 py-0.5 text-[11px] max-w-[200px]"
            style={{ backgroundColor: 'var(--panel-elevated)', color: 'var(--ink)', borderColor: inspectValue ? 'var(--storm)' : 'var(--border)' }}
          >
            <option value="">Flight or airport…</option>
            <optgroup label={`Airports (${airports.length})`}>
              {airports.map((a) => (
                <option key={`air-${a.id}`} value={`airport:${a.id}`}>
                  {a.id} · {a.city}
                </option>
              ))}
            </optgroup>
            <optgroup label={`Flights (${flights.length})`}>
              {flights.map((f) => (
                <option key={`flt-${f.flight_id}`} value={`flight:${f.flight_id}`}>
                  {f.flight_id} {f.origin}→{f.destination}
                  {f.cancelled ? ' (Canc)' : f.delayMin > 0 ? ` (+${f.delayMin}m)` : ''}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
      </div>
    </div>
  );
}
