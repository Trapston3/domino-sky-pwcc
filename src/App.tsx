import { useCallback, useMemo, useState } from 'react';
import { FlightCanvas } from './canvas/FlightCanvas.js';
import { DominoTraceCard } from './components/DominoTraceCard.js';
import { KpiStrip } from './components/KpiStrip.js';
import { PlainStatsView } from './components/PlainStatsView.js';
import {
  DEFAULT_CLOCK_MIN,
  PLAYBACK_END_MIN,
  PLAYBACK_START_MIN,
  PlaybackBar,
  type PlaybackSpeed,
} from './components/PlaybackBar.js';
import { RightRailStack } from './components/RightRailStack.js';
import { ScenarioBar, type ThemeMode, type ViewMode } from './components/ScenarioBar.js';
import { useAppShellEffects } from './components/useAppShellEffects.js';
import { useNetworkSimulation } from './components/useNetworkSimulation.js';
import { FLIGHT_NETWORK } from './data/flightNetwork.js';

function getInitialReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function getInitialRightInset(): number {
  if (typeof window === 'undefined') return 412;
  return window.innerWidth >= 1024 ? 412 : 0;
}

/** Root Domino Sky shell coordinating scenario state, engine simulation, canvas map, and Plain Stats. */
export default function App() {
  const [viewMode, setViewMode] = useState<ViewMode>('map');
  const [canvasUnavailable, setCanvasUnavailable] = useState<boolean>(false);
  const [theme, setTheme] = useState<ThemeMode>('night');
  const [is3D, setIs3D] = useState<boolean>(true);
  const [reducedMotion, setReducedMotion] = useState<boolean>(getInitialReducedMotion);
  const [rightPanelInsetPx, setRightPanelInsetPx] = useState<number>(getInitialRightInset);

  const [currentTimeMin, setCurrentTimeMin] = useState<number>(DEFAULT_CLOCK_MIN);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);

  const [selectedFlightId, setSelectedFlightId] = useState<string | null>(null);
  const [selectedAirportId, setSelectedAirportId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<string>('');

  const sim = useNetworkSimulation(FLIGHT_NETWORK, setAnnouncement);

  const handleTogglePlay = useCallback(() => {
    setIsPlaying((prev) => {
      if (!prev && currentTimeMin >= PLAYBACK_END_MIN) setCurrentTimeMin(PLAYBACK_START_MIN);
      return !prev;
    });
  }, [currentTimeMin]);

  const handleReducedMotionChange = useCallback((reduced: boolean) => {
    setReducedMotion(reduced);
    if (reduced) setIsPlaying(false);
  }, []);

  useAppShellEffects({
    theme,
    viewMode,
    onReducedMotionChange: handleReducedMotionChange,
    onRightInsetChange: setRightPanelInsetPx,
    onSpaceTogglePlay: handleTogglePlay,
  });

  const selectedTailId = useMemo(() => {
    if (!selectedFlightId || !sim.currentResult) return null;
    const flight = sim.currentResult.flights.find((f) => f.flight_id === selectedFlightId);
    return flight ? (flight.cancelled ? flight.tail_id : flight.operatingTail) : null;
  }, [selectedFlightId, sim.currentResult]);

  const handleAdvanceClock = useCallback((nextTimeMin: number, reachedEnd?: boolean) => {
    setCurrentTimeMin(Math.max(PLAYBACK_START_MIN, Math.min(PLAYBACK_END_MIN, nextTimeMin)));
    if (reachedEnd) setIsPlaying(false);
  }, []);

  const handleSelectFlight = useCallback((flightId: string) => {
    setSelectedFlightId(flightId);
    setSelectedAirportId(null);
    setAnnouncement(`Opened Domino Trace for flight ${flightId}.`);
  }, []);

  const handleSelectAirport = useCallback((airportId: string) => {
    setSelectedAirportId(airportId);
    setSelectedFlightId(null);
    const airport = FLIGHT_NETWORK.airports.find((item) => item.id === airportId);
    setAnnouncement(`Opened Domino Trace for ${airportId}${airport ? `, ${airport.city}` : ''}.`);
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedFlightId(null);
    setSelectedAirportId(null);
    setAnnouncement('Closed Domino Trace.');
  }, []);

  const handleCanvasError = useCallback(() => {
    setCanvasUnavailable(true);
    setViewMode('plain');
    setIsPlaying(false);
    setAnnouncement('2D map canvas unavailable; switched to Plain Stats mode.');
  }, []);

  const scenarioBarNode = (
    <ScenarioBar
      airports={FLIGHT_NETWORK.airports}
      flights={sim.currentResult?.flights ?? []}
      closure={sim.closure}
      surge={sim.currentResult?.surge ?? null}
      theme={theme}
      viewMode={viewMode}
      is3D={is3D}
      canvasUnavailable={canvasUnavailable}
      selectedFlightId={selectedFlightId}
      selectedAirportId={selectedAirportId}
      onSelectClosure={sim.selectClosure}
      onToggleTheme={() => {
        const next: ThemeMode = theme === 'night' ? 'day' : 'night';
        setTheme(next);
        setAnnouncement(`Switched to ${next === 'night' ? 'Night' : 'Day'} theme.`);
      }}
      onToggleViewMode={() => {
        if (canvasUnavailable && viewMode === 'plain') return;
        const next: ViewMode = viewMode === 'map' ? 'plain' : 'map';
        setViewMode(next);
        if (next === 'plain') setIsPlaying(false);
        setAnnouncement(`Switched to ${next === 'map' ? 'Map view' : 'Plain stats mode'}.`);
      }}
      onToggle3D={() => setIs3D((prev) => !prev)}
      onSelectFlight={handleSelectFlight}
      onSelectAirport={handleSelectAirport}
      onClearSelection={handleClearSelection}
    />
  );

  if (!sim.baselineResult || !sim.currentResult) {
    return (
      <div className="min-h-screen p-4 max-w-4xl mx-auto flex flex-col gap-4">
        <div className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div>
        {scenarioBarNode}
        <main id="main-content" className="surface-panel rounded-xl p-6 text-sm" role="alert">
          <p style={{ color: 'var(--breach-text)' }}>
            ▲ Simulation failed: {!sim.currentOutcome.ok ? sim.currentOutcome.reason : !sim.baselineOutcome.ok ? sim.baselineOutcome.reason : 'Unknown error'}
          </p>
        </main>
      </div>
    );
  }

  const traceCardNode = (selectedFlightId || selectedAirportId) ? (
    <DominoTraceCard
      dataset={FLIGHT_NETWORK}
      simulation={sim.currentResult}
      currentTimeMin={currentTimeMin}
      selectedFlightId={selectedFlightId}
      selectedAirportId={selectedAirportId}
      onSelectFlight={handleSelectFlight}
      onSelectAirport={handleSelectAirport}
      onClose={handleClearSelection}
    />
  ) : null;

  const railNode = (
    <RightRailStack
      dataset={FLIGHT_NETWORK}
      closure={sim.closure}
      baselineResult={sim.baselineResult}
      currentResult={sim.currentResult}
      previewResult={sim.previewResult}
      previewRec={sim.previewRec}
      appliedActions={sim.appliedActions}
      objective={sim.objective}
      recommendations={sim.recommendations}
      actionError={sim.actionError}
      onAnnounce={setAnnouncement}
      currentTimeMin={currentTimeMin}
      includeKpiAndFeed={viewMode === 'map'}
      onSelectObjective={sim.selectObjective}
      onPreview={sim.setPreviewRec}
      onApply={sim.applyRecommendation}
      onUndo={sim.undoAction}
      onClear={sim.clearActions}
      onDismissError={sim.clearError}
      onSelectFlight={handleSelectFlight}
      onSelectAirport={handleSelectAirport}
    />
  );

  if (viewMode === 'plain') {
    return (
      <div className="min-h-screen px-3 py-3 sm:px-5 sm:py-4 max-w-[1600px] mx-auto flex flex-col gap-4">
        <a href="#main-content" aria-label="Skip to main disruption view" className="skip-link">
          Skip to main disruption view
        </a>
        <div className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div>
        {scenarioBarNode}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_370px] xl:grid-cols-[minmax(0,1fr)_400px] gap-4 items-start">
          <main id="main-content" aria-label="Network disruption KPIs and plain stats operational view" className="min-w-0 flex flex-col gap-4">
            {traceCardNode}
            <KpiStrip
              layout="wide"
              baselineSummary={sim.baselineResult.summary}
              currentSummary={sim.currentResult.summary}
              previewSummary={sim.previewResult?.summary ?? null}
              previewTitle={sim.previewRec?.title ?? null}
              appliedCount={sim.appliedActions.length}
            />
            <PlainStatsView
              dataset={FLIGHT_NETWORK}
              baselineResult={sim.baselineResult}
              currentResult={sim.currentResult}
              previewResult={null}
              appliedCount={sim.appliedActions.length}
              onSelectFlight={handleSelectFlight}
            />
          </main>
          <aside aria-label="Recovery optimizer and operational summary" className="flex flex-col gap-3">
            {railNode}
          </aside>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen lg:h-screen w-full lg:overflow-hidden">
      <a href="#main-content" aria-label="Skip to main disruption map and trace" className="skip-link">
        Skip to main disruption map and trace
      </a>
      <div className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div>

      <div className="fixed inset-0 z-0">
        <FlightCanvas
          dataset={FLIGHT_NETWORK}
          simulation={sim.currentResult}
          previewSimulation={sim.previewResult}
          currentTimeMin={currentTimeMin}
          isPlaying={isPlaying}
          speed={speed}
          is3D={is3D}
          theme={theme}
          reducedMotion={reducedMotion}
          selectedFlightId={selectedFlightId}
          selectedTailId={selectedTailId}
          selectedAirportId={selectedAirportId}
          rightPanelInsetPx={rightPanelInsetPx}
          onAdvanceClock={handleAdvanceClock}
          onSelectFlight={handleSelectFlight}
          onSelectAirport={handleSelectAirport}
          onClearSelection={handleClearSelection}
          onCanvasError={handleCanvasError}
        />
      </div>

      <div className="relative z-10 min-h-screen lg:h-full w-full pointer-events-none p-2.5 sm:p-3.5 flex flex-col gap-2.5">
        {scenarioBarNode}
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row items-stretch justify-between gap-3">
          <main id="main-content" aria-label="Interactive disruption map trace and playback controls" className="min-w-0 flex-1 flex flex-col justify-end gap-2.5 pointer-events-none min-h-[300px]">
            {traceCardNode && <div className="pointer-events-auto max-w-xl">{traceCardNode}</div>}
            <div className="pointer-events-auto w-full">
              <PlaybackBar
                currentTimeMin={currentTimeMin}
                isPlaying={isPlaying}
                speed={speed}
                closure={sim.closure}
                reducedMotion={reducedMotion}
                onTogglePlay={handleTogglePlay}
                onChangeSpeed={setSpeed}
                onScrubTime={(t) => {
                  setIsPlaying(false);
                  setCurrentTimeMin(t);
                }}
                onResetClock={() => {
                  setIsPlaying(false);
                  setCurrentTimeMin(DEFAULT_CLOCK_MIN);
                }}
              />
            </div>
          </main>
          <aside aria-label="KPIs, live event feed, recovery optimizer, and operational summary" className="pointer-events-auto w-full lg:w-[376px] xl:w-[396px] shrink-0 lg:min-h-0 lg:overflow-y-auto flex flex-col gap-2.5 pr-0.5">
            {railNode}
          </aside>
        </div>
      </div>
    </div>
  );
}
