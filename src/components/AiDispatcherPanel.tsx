import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { formatActionLabel } from '../engine/index.js';
import type {
  ClosureSpec,
  FlightNetworkDataset,
  Objective,
  RecoveryAction,
  RecoveryRecommendation,
  SimulationResult,
} from '../engine/types.js';

interface AiDispatcherPanelProps {
  dataset: FlightNetworkDataset;
  closure: ClosureSpec | null;
  simulation: SimulationResult;
  appliedActions: readonly RecoveryAction[];
  objective: Objective;
  recommendations: readonly RecoveryRecommendation[];
  onSelectFlight: (flightId: string) => void;
}

interface DispatchApiResponse {
  source?: string; text?: string; degraded?: boolean; notice?: string; error?: string;
}

const STARTER_PROMPTS = ['Why is DS0702 delayed?', 'Compare compliance vs delay recovery', 'Which connections break without action?'] as const;
const FLIGHT_ID_SPLIT_RE = /\b(DS\d{4})\b/g;

function buildLocalFallbackBrief(
  dataset: FlightNetworkDataset,
  closure: ClosureSpec | null,
  simulation: SimulationResult,
  appliedActions: readonly RecoveryAction[],
  objective: Objective,
  recommendations: readonly RecoveryRecommendation[],
): string {
  const s = simulation.summary;
  const lines: string[] = [];
  if (!closure) {
    lines.push(`Clear skies across ${dataset.airports.length} airports (${s.totalFlights} scheduled flights).`);
  } else {
    const ap = dataset.airports.find((a) => a.id === closure.airport);
    const label = ap ? `${closure.airport} (${ap.city})` : closure.airport;
    lines.push(
      `Ground stop at ${label} ${closure.start}–${closure.end} IST: ${s.lateFlights}/${s.totalFlights} late (${s.totalDelayMin}m delay), ${s.strandedPax} stranded pax (${s.missedConnectionPax} missed-conn + ${s.cancelledPax} cancelled), ${s.crewBreaches} crew breaches.`,
    );
  }
  if (appliedActions.length > 0) {
    lines.push(`Active recovery (${appliedActions.length}): ${appliedActions.map(formatActionLabel).join('; ')}.`);
  }
  const worst = simulation.flights
    .filter((f) => !f.cancelled && f.delayMin > 0)
    .sort((a, b) => b.delayMin - a.delayMin || a.flight_id.localeCompare(b.flight_id))
    .slice(0, 3);
  if (worst.length > 0) {
    lines.push(`Key delays: ${worst.map((f) => `${f.flight_id} (${f.origin}→${f.destination} +${f.delayMin}m)`).join(', ')}.`);
  }
  const breached = simulation.crews.filter((c) => c.breached);
  if (breached.length > 0) {
    lines.push(`Crew breaches: ${breached.map((c) => `${c.crewId} +${c.overageMin}m on ${c.breachedFlightIds.join(', ')}`).join('; ')}.`);
  }
  if (recommendations[0]) lines.push(`Top ${objective} option: ${recommendations[0].title}.`);
  return lines.join('\n');
}

function renderLinesWithFlightChips(
  text: string,
  knownFlightIds: ReadonlySet<string>,
  onSelectFlight: (flightId: string) => void,
) {
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line, lineIdx) => (
      <p key={`line-${lineIdx}`}>
        {line.split(FLIGHT_ID_SPLIT_RE).map((part, partIdx) =>
          knownFlightIds.has(part) ? (
            <button
              key={`${part}-${lineIdx}-${partIdx}`}
              type="button"
              onClick={() => onSelectFlight(part)}
              aria-label={`Inspect flight ${part} domino trace`}
              className="font-mono-tabular inline-flex items-center rounded border px-1 py-0 text-[11px] font-semibold mx-0.5 cursor-pointer"
              style={{ backgroundColor: 'var(--panel-solid)', color: 'var(--storm-text)', borderColor: 'var(--storm)' }}
            >
              {part}
            </button>
          ) : (
            <span key={`txt-${lineIdx}-${partIdx}`}>{part}</span>
          ),
        )}
      </p>
    ));
}

/** AI Dispatcher briefing and grounded Q&A panel backed by `/api/dispatch` with deterministic degradation. */
export function AiDispatcherPanel({
  dataset,
  closure,
  simulation,
  appliedActions,
  objective,
  recommendations,
  onSelectFlight,
}: AiDispatcherPanelProps) {
  const knownFlightIds = useMemo(() => new Set(dataset.flights.map((f) => f.flight_id)), [dataset.flights]);
  const fallbackBrief = useMemo(
    () => buildLocalFallbackBrief(dataset, closure, simulation, appliedActions, objective, recommendations),
    [dataset, closure, simulation, appliedActions, objective, recommendations],
  );

  const [source, setSource] = useState<string>('DETERMINISTIC ENGINE');
  const [briefText, setBriefText] = useState<string>('');
  const [degraded, setDegraded] = useState<boolean>(false);
  const [degradedNotice, setDegradedNotice] = useState<string | null>(null);
  const [isLoadingBrief, setIsLoadingBrief] = useState<boolean>(false);
  const [question, setQuestion] = useState<string>('');
  const [isAsking, setIsAsking] = useState<boolean>(false);
  const [qaTurn, setQaTurn] = useState<{ question: string; answer: string } | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);

  const askAbortRef = useRef<AbortController | null>(null);
  const fallbackRef = useRef<string>(fallbackBrief);
  fallbackRef.current = fallbackBrief;

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setIsLoadingBrief(true);
      try {
        const res = await fetch('/api/dispatch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'brief', closure, actions: appliedActions, objective }),
          signal: controller.signal,
        });
        const data = (await res.json().catch(() => ({}))) as DispatchApiResponse;
        if (controller.signal.aborted) return;
        if (res.status === 429) {
          setInlineError('Slow down — rate limit reached (20 req/min). Keeping last result.');
          return;
        }
        if (!res.ok) {
          setInlineError(data.error ?? 'Unable to refresh briefing.');
          return;
        }
        setSource(typeof data.source === 'string' ? data.source : 'DETERMINISTIC ENGINE');
        setBriefText(typeof data.text === 'string' && data.text.trim() ? data.text : fallbackRef.current);
        setDegraded(Boolean(data.degraded));
        setDegradedNotice(data.degraded ? (data.notice ?? 'AI unavailable — showing deterministic engine briefing.') : null);
        setInlineError(null);
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return;
        setSource('DETERMINISTIC ENGINE');
        setBriefText(fallbackRef.current);
      } finally {
        if (!controller.signal.aborted) setIsLoadingBrief(false);
      }
    }, 150);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [closure, appliedActions, objective]);

  const submitQuestion = useCallback(
    async (rawQuestion: string) => {
      const trimmed = rawQuestion.trim().slice(0, 300);
      if (!trimmed) {
        setInlineError('Please enter a question (up to 300 characters).');
        return;
      }
      askAbortRef.current?.abort();
      const controller = new AbortController();
      askAbortRef.current = controller;
      setIsAsking(true);
      setInlineError(null);
      try {
        const res = await fetch('/api/dispatch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'ask', closure, actions: appliedActions, objective, question: trimmed }),
          signal: controller.signal,
        });
        const data = (await res.json().catch(() => ({}))) as DispatchApiResponse;
        if (controller.signal.aborted) return;
        if (res.status === 429) {
          setInlineError('Slow down — rate limit reached (20 req/min). Keeping last result.');
          return;
        }
        if (res.status === 400 || !res.ok) {
          setInlineError(data.error ?? 'Invalid request parameters.');
          return;
        }
        setSource(typeof data.source === 'string' ? data.source : 'DETERMINISTIC ENGINE');
        setDegraded(Boolean(data.degraded));
        setDegradedNotice(data.degraded ? (data.notice ?? 'AI unavailable — showing deterministic answer.') : null);
        setQaTurn({ question: trimmed, answer: typeof data.text === 'string' && data.text.trim() ? data.text : fallbackRef.current });
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return;
        setQaTurn({ question: trimmed, answer: fallbackRef.current });
      } finally {
        if (!controller.signal.aborted) setIsAsking(false);
      }
    },
    [closure, appliedActions, objective],
  );

  function handleFormSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void submitQuestion(question);
  }

  const displayedBrief = briefText.trim().length > 0 ? briefText : fallbackBrief;
  const isVertex = source.startsWith('VERTEX AI');
  const badgeStyle = isVertex
    ? { borderColor: 'var(--storm)', color: 'var(--storm-text)', backgroundColor: 'var(--storm-bg)' }
    : { borderColor: 'var(--spare)', color: 'var(--spare-text)', backgroundColor: 'var(--spare-bg)' };

  return (
    <section aria-label="AI dispatcher briefing and ask box" className="surface-panel rounded-xl p-3.5 flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <div className="flex items-center gap-1.5">
          <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>Dispatcher Briefing</h2>
          {isLoadingBrief && <span className="font-mono-tabular text-[10px]" style={{ color: 'var(--muted)' }}>· syncing…</span>}
        </div>
        <span className="font-mono-tabular rounded border px-1.5 py-0.5 text-[10px] font-medium" style={badgeStyle}>
          {isVertex ? `✦ ${source}` : `⚙ ${source}`}
        </span>
      </div>

      {degraded && (
        <div className="rounded-md border px-2 py-1 text-[11px] flex items-center gap-1.5" style={{ backgroundColor: 'var(--delay-bg)', borderColor: 'var(--delay)', color: 'var(--delay-text)' }}>
          <span aria-hidden="true">◔</span>
          <span>{degradedNotice ?? 'AI unavailable — showing deterministic engine briefing.'}</span>
        </div>
      )}

      <div className="flex flex-col gap-1.5 text-xs leading-relaxed max-h-44 overflow-y-auto pr-0.5" style={{ color: 'var(--ink)' }}>
        {renderLinesWithFlightChips(displayedBrief, knownFlightIds, onSelectFlight)}
      </div>

      {qaTurn && (
        <div className="surface-elevated rounded-lg p-2.5 flex flex-col gap-1.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold" style={{ color: 'var(--storm-text)' }}>Q: {qaTurn.question}</span>
            <button type="button" onClick={() => setQaTurn(null)} aria-label="Clear dispatcher question answer" className="font-mono-tabular text-[10px] cursor-pointer" style={{ color: 'var(--muted)' }}>✕</button>
          </div>
          <div className="flex flex-col gap-1 leading-relaxed" style={{ color: 'var(--ink)' }}>
            {renderLinesWithFlightChips(qaTurn.answer, knownFlightIds, onSelectFlight)}
          </div>
        </div>
      )}

      {inlineError && (
        <div role="alert" className="rounded-lg border px-2.5 py-1.5 text-xs flex items-center justify-between gap-2" style={{ backgroundColor: 'var(--breach-bg)', borderColor: 'var(--breach)', color: 'var(--breach-text)' }}>
          <span>▲ {inlineError}</span>
          <button type="button" onClick={() => setInlineError(null)} aria-label="Dismiss dispatcher alert" className="font-semibold cursor-pointer px-1" style={{ color: 'var(--breach-text)' }}>✕</button>
        </div>
      )}

      <form onSubmit={handleFormSubmit} className="flex flex-col gap-2 pt-1.5 border-t" style={{ borderColor: 'var(--border)' }}>
        <div role="group" aria-label="Starter dispatcher questions" className="flex flex-wrap gap-1">
          {STARTER_PROMPTS.map((prompt) => (
            <button key={prompt} type="button" onClick={() => { setQuestion(prompt); void submitQuestion(prompt); }} aria-label={`Ask starter prompt: ${prompt}`} className="surface-elevated rounded-md px-2 py-0.5 text-[10px] font-medium cursor-pointer text-left" style={{ color: 'var(--ink)' }}>
              {prompt}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <input type="text" maxLength={300} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask dispatcher (max 300 chars)…" aria-label="Ask dispatcher a question about flights, crews, connections, or recovery" className="flex-1 min-w-0 rounded-lg border px-2.5 py-1.5 text-xs" style={{ backgroundColor: 'var(--panel-elevated)', color: 'var(--ink)', borderColor: 'var(--border)' }} />
          <span className="font-mono-tabular text-[10px] shrink-0" style={{ color: 'var(--muted)' }}>{question.length}/300</span>
          <button type="submit" disabled={isAsking || question.trim().length === 0} aria-label="Submit question to dispatcher" className="rounded-lg px-2.5 py-1.5 text-xs font-semibold cursor-pointer shrink-0 disabled:opacity-50 disabled:cursor-not-allowed" style={{ backgroundColor: 'var(--button-primary-bg)', color: 'var(--button-primary-ink)' }}>
            {isAsking ? '…' : 'Ask'}
          </button>
        </div>
      </form>
    </section>
  );
}
