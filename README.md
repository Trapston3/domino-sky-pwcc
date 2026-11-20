# Domino Sky

*Close one airport. Watch what falls over.*

## 1. Chosen Vertical

**Flight Disruption Cascade & Recovery** across an Indian domestic airline network (`flight_network.json`).

A single airport ground stop triggers a nonlinear operational cascade: inbound and outbound aircraft are held, turnaround slack is consumed, downstream legs on the same tail slip across the country, connecting passengers miss onward flights at hubs, and flight crews breach Flight Duty Time Limitations (FDTL). **Domino Sky** simulates the full day's schedule (`06:00–21:45 IST`, plus delayed arrivals past midnight) across **16 Indian airports**, **70 flights** on **16 active tails (`VT-DS01..VT-DS16`)**, **21 passenger hub connections (`CX01..CX21`)**, **16 flight crews (`CR01..CR16`, 600-minute max duty)**, and **2 standby spare aircraft (`VT-DS17` at `BLR`, `VT-DS18` at `DEL`)**, and recommends verified recovery plans.

## 2. Approach & Logic

- **Deterministic Engine Computes, AI Only Narrates (`src/engine/`)**:
  - `simulateNetwork(dataset, closure, actions)` is a pure, side-effect-free TypeScript engine (zero DOM, Node, or data-file imports). It iterates per-tail chains in ascending `leg_order` to a fixed point (**max 10 passes**) so cross-tail `HOLD_CONNECTION` dependencies converge deterministically.
  - Every delayed flight receives an exact causal trace (`causeSteps[]`), recording closure holds, connection holds, turnaround slack absorbed (`min_turnaround_minutes = 30`), and delay carried forward.
  - `optimizeRecovery(dataset, closure, objective, baseActions)` evaluates every valid single action (`SWAP_SPARE`, `CANCEL_TAIL_END`, `CANCEL_LOOP`, `HOLD_CONNECTION`) plus top non-conflicting pairs and connection-hold follow-ups while crew breaches remain. It ranks candidates by **Compliance** (`breaches → stranded pax → total delay`), **Passengers** (`stranded + cancelled pax → breaches → delay`), or **Delay** (`total delay → breaches → stranded pax`), and computes `sideEffects[]` strictly by diffing `SimulationResult` objects (`diffSimulations`).
  - All KPIs, delta badges (`was X`), tables, and Before→After numbers in the UI are rendered directly from engine JSON—never parsed from AI prose.
- **Zero-Trust Server Recompute (`api/dispatch.ts`, `src/server/`)**:
  - The client sends only `{ mode: 'brief' | 'ask', closure, actions, objective, question? }`.
  - The server enforces an 8 KB payload cap (`MAX_BODY_BYTES = 8192`), validates airport IDs, `HH:MM` timestamps (`start < end`, duration `<= 240`), action schemas (`<= 5` actions), objective enum, and trimmed `question` (`<= 300` chars), strips all unknown fields, and recomputes baseline, active, and candidate simulations from scratch with `src/engine/`.
- **Vertex AI & Gemini 3+ Tool Loop (`@google/genai`)**:
  - Default model: `process.env.VERTEX_MODEL || 'gemini-3.8-flash'`.
  - `brief` mode runs with `thinkingConfig: { thinkingLevel: 'LOW' }`; `ask` mode runs with `'MEDIUM'` and three engine-backed tools: `simulate_custom_actions(actions)`, `inspect_flight(flight_id)`, and `compare_objectives()`.
  - Across tool rounds (max 4 rounds, 25 s overall timeout), the server appends `candidate.content` **unchanged** (preserving Gemini 3+ `thoughtSignature`) and echoes `functionCall.id` on each `functionResponse`.
  - Untrusted `question` text is sandboxed by system instructions that forbid rule overrides and require citing only IDs and numbers present in tool/payload output.
  - If no credentials are configured or Vertex AI fails after retry (including an automatic retry without `thinkingConfig` if rejected), `api/dispatch` degrades gracefully to `buildDeterministicBriefing` (`source: 'DETERMINISTIC ENGINE'`).

## 3. How It Works

- **2D/3D Perspective India Map (`src/canvas/`)**:
  - Pure HTML5 Canvas 2D context (DPR capped at 2, single `requestAnimationFrame` loop, zero per-frame allocations) with a hand-written perspective camera (`0°` 2D top-down ↔ `38°` 3D tilt, pointer drag tilt/yaw, double-click reset).
  - Embeds a 75-vertex mainland India outline and precomputed 890-dot interior landmass grid.
  - Precomputes 70 parabolic 3D flight arcs and ground shadows in typed arrays, plus 16-point ring buffers for additive-blend glowing comet trails colored by live status (`on_time`, `minor_delay`, `major_delay`, `recovered`).
  - Closed airports render a pre-closure dashed warning ring, concentric pulsing violet ground-stop rings with an upright `GROUND STOP UNTIL HH:MM` badge, and queued halos with an `N held` counter.
- **Domino Trace Card & Live Event Feed**:
  - Click any aircraft, route arc, airport, live-feed chip, or use the keyboard-reachable **Inspect** dropdown in the top bar to highlight the full tail chain and open the **Domino Trace Card** (leg-by-leg schedule vs actual times, `causeSteps[]`, turnaround slack, touching connections, and a 600-minute crew duty progress bar).
- **Recovery Optimizer & Hover-to-Preview**:
  - Switch objectives (`Compliance`, `Passengers`, `Delay`), hover or keyboard-focus any recommendation card to preview its effect live on both the map and KPI strip (`was X` deltas), apply stackable actions, or `Undo`/`Clear`.
- **Plain Stats Mode (`src/components/PlainStatsView.tsx`)**:
  - Toggle **Plain stats** (or auto-fallback if Canvas 2D context fails) for full operational parity without the canvas: Before/After recovery summary table, filterable Flights table with a **"Why late?"** column, Connections table, Crews 600m duty table, and a Tail-Chain CSS timeline across all tails and active spares.
- **Local Development, Verification & Vercel Setup**:
  1. Install dependencies: `npm install`
  2. Start local dev server (works with zero credentials in `DETERMINISTIC ENGINE` mode): `npm run dev`
  3. Copy `.env.example` to `.env` (or configure Vercel Environment Variables) for Vertex AI:
     - **Option 1 (API Key)**: `GOOGLE_VERTEX_API_KEY=<key>`
     - **Option 2 (Service Account)**: `GCP_SERVICE_ACCOUNT_B64=<base64-json>`, `GOOGLE_CLOUD_PROJECT=<project-id>`, `GOOGLE_CLOUD_LOCATION=global`
     - **Model**: `VERTEX_MODEL=gemini-3.8-flash`
  4. Run the full verification gate:
     ```bash
     npm run verify
     ```
     Runs `npm run typecheck` (`tsc --noEmit`), `npm test` (Vitest golden + API + dispatch suites), `npm run build` (`vite build`), and `node scripts/check-size.mjs` (verifies tracked repo size `< 1 MB`).
  5. Deploy smoke test: hit `GET /api/ping` (`{ ok: true, flights: 70, baselineLate: 0 }`).

## 4. Assumptions

- **Crew duty is measured to actual arrival**: Crew duty duration (`dutyMin = lastOperatedFlight.actualArr - duty_start`) is measured to the **actual** arrival of the crew's final operated leg rather than scheduled arrival (the dataset's `meta.notes` mentions scheduled arrival; actual arrival is stricter and is what all 11 golden test numbers use). Any crew with `dutyMin > 600` is flagged `BREACHED` (`overageMin = dutyMin - 600`), along with each operated leg whose `actualArr - duty_start > 600`.
- **Spares carry a standby hub crew**: When `SWAP_SPARE(spareTail, flightId)` is applied (`VT-DS17` at `BLR` or `VT-DS18` at `DEL`, each usable once on a flight departing its base), a standby hub crew assumes the swapped leg and all subsequent legs on that tail. The standby crew's 600-minute duty clock starts **45 minutes before the swap leg's `actualDep`**, and the original crew's duty ends at the swap hub. A spare may be swapped onto a leg scheduled during a closure at its base (it is held until reopening).
- **Closures hold both departures and arrival-bound flights (ground delay)**: If a flight's `origin === closedAirport` and `start <= actualDep < end`, departure is held to `end`. If a flight's `destination === closedAirport` and `start <= tentativeArr < end`, the flight takes a ground delay at its origin so `actualArr = end`.
- **Passenger breakdown without double-counting**: A connection is `made` iff neither flight is cancelled and `to.actualDep - from.actualArr >= min_connect_minutes`. If either flight is cancelled, the connection is marked `cancelled` (not `broken`) so passengers are never double-counted: `strandedPax = missedConnectionPax + cancelledPax`. Passengers on legs operated past the 600-minute crew limit are reported separately as `crewBreachAtRiskPax`.
- **Reopening surge is informational**: Reopening surge counts movements touching the closed airport in `[end, end + 60)` divided by `capacity_per_hour`. It never alters delay math.
- **Operational scope & per-instance rate limiting**: No fuel, ATC slot, maintenance, or en-route weather modelling is included. The `/api/dispatch` rate limiter (`20 req/min/IP`) is best-effort in-memory per serverless function instance.
