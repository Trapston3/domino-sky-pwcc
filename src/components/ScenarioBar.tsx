import { useState } from 'react';
import type { Airport, ClosureSpec, ReopeningSurge, SimulatedFlight } from '../engine/types.js';
import { ClosureControls } from './ClosureControls.js';
import { SurgeBadge } from './SurgeBadge.js';

export type ThemeMode = 'night' | 'day';
export type ViewMode = 'map' | 'plain';

interface ScenarioBarProps {
  airports: readonly Airport[];
  flights: readonly SimulatedFlight[];
  closure: ClosureSpec | null;
  surge: ReopeningSurge | null;
  theme: ThemeMode;
  viewMode: ViewMode;
  is3D: boolean;
  canvasUnavailable: boolean;
  selectedFlightId: string | null;
  selectedAirportId: string | null;
  onSelectClosure: (closure: ClosureSpec | null, label?: string) => void;
  onToggleTheme: () => void;
  onToggleViewMode: () => void;
  onToggle3D: () => void;
  onSelectFlight: (flightId: string) => void;
  onSelectAirport: (airportId: string) => void;
  onClearSelection: () => void;
}

/** Floating top navigation bar: branding, surge badge, closure controls, and view/3D/theme toggles. */
export function ScenarioBar({
  airports,
  flights,
  closure,
  surge,
  theme,
  viewMode,
  is3D,
  canvasUnavailable,
  selectedFlightId,
  selectedAirportId,
  onSelectClosure,
  onToggleTheme,
  onToggleViewMode,
  onToggle3D,
  onSelectFlight,
  onSelectAirport,
  onClearSelection,
}: ScenarioBarProps) {
  const [timeHint, setTimeHint] = useState<string | null>(null);
  const [mobileControlsOpen, setMobileControlsOpen] = useState<boolean>(true);

  return (
    <header className="w-full pointer-events-none">
      <nav aria-label="Scenario, inspection, and display controls" className="flex flex-wrap items-start justify-between gap-2.5">
        <div className="surface-panel pointer-events-auto rounded-xl px-3.5 py-2.5 shadow-lg flex-1 min-w-[280px] max-w-5xl flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
              <h1 className="font-display text-xl sm:text-2xl font-semibold tracking-tight leading-none" style={{ color: 'var(--ink)' }}>
                Domino Sky
              </h1>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                Close one airport. Watch what falls over.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <SurgeBadge surge={surge} />
              <button
                type="button"
                onClick={() => setMobileControlsOpen((prev) => !prev)}
                aria-expanded={mobileControlsOpen}
                aria-label={mobileControlsOpen ? 'Collapse scenario controls' : 'Expand scenario controls'}
                className="sm:hidden surface-elevated rounded-md px-2 py-1 text-[11px] font-medium cursor-pointer"
                style={{ color: 'var(--ink)' }}
              >
                {mobileControlsOpen ? '▲ Hide' : '▼ Scenarios'}
              </button>
            </div>
          </div>

          <div className={`${mobileControlsOpen ? 'block' : 'hidden sm:block'} pt-1.5 border-t`} style={{ borderColor: 'var(--border)' }}>
            <ClosureControls
              airports={airports}
              flights={flights}
              closure={closure}
              selectedFlightId={selectedFlightId}
              selectedAirportId={selectedAirportId}
              onSelectClosure={onSelectClosure}
              onSelectFlight={onSelectFlight}
              onSelectAirport={onSelectAirport}
              onClearSelection={onClearSelection}
              onTimeHintChange={setTimeHint}
            />
          </div>

          {timeHint && (
            <p className="text-xs font-medium" style={{ color: 'var(--breach-text)' }} role="alert">
              ▲ {timeHint}
            </p>
          )}
        </div>

        <div role="group" aria-label="View, camera, and theme toggles" className="surface-panel pointer-events-auto rounded-xl p-1.5 shadow-lg inline-flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onToggleViewMode}
            disabled={canvasUnavailable && viewMode === 'plain'}
            aria-pressed={viewMode === 'plain'}
            aria-label={
              canvasUnavailable
                ? 'Plain stats mode active (2D canvas unavailable)'
                : viewMode === 'plain'
                  ? 'Switch to 3D/2D Map view'
                  : 'Switch to Plain stats tables view'
            }
            title={canvasUnavailable ? '2D canvas unavailable in this browser' : undefined}
            className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            style={
              viewMode === 'plain'
                ? { backgroundColor: 'var(--pill-active-bg)', color: 'var(--pill-active-ink)', borderColor: 'var(--pill-active-bg)' }
                : { backgroundColor: 'var(--panel-elevated)', color: 'var(--ink)', borderColor: 'var(--border)' }
            }
          >
            <span aria-hidden="true">{viewMode === 'plain' ? '🗺' : '▤'}</span>
            <span>{viewMode === 'plain' ? 'Map view' : 'Plain stats'}</span>
          </button>

          <button
            type="button"
            onClick={onToggle3D}
            disabled={viewMode === 'plain'}
            aria-pressed={is3D}
            aria-label={is3D ? 'Switch map camera to 2D top-down' : 'Switch map camera to 3D perspective'}
            className="font-mono-tabular inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
            style={
              is3D && viewMode === 'map'
                ? { backgroundColor: 'var(--storm-bg)', color: 'var(--storm-text)', borderColor: 'var(--storm)' }
                : { backgroundColor: 'var(--panel-elevated)', color: 'var(--ink)', borderColor: 'var(--border)' }
            }
          >
            <span aria-hidden="true">{is3D ? '◇' : '□'}</span>
            <span>{is3D ? '3D' : '2D'}</span>
          </button>

          <button
            type="button"
            onClick={onToggleTheme}
            aria-pressed={theme === 'day'}
            aria-label={theme === 'night' ? 'Switch to Day theme' : 'Switch to Night theme'}
            className="surface-elevated inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium cursor-pointer"
            style={{ color: 'var(--ink)' }}
          >
            <span aria-hidden="true">{theme === 'night' ? '☀' : '☾'}</span>
            <span>{theme === 'night' ? 'Night' : 'Day'}</span>
          </button>
        </div>
      </nav>
    </header>
  );
}
