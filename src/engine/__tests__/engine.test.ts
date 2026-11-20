import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FLIGHT_NETWORK } from '../../data/flightNetwork.js';
import {
  compareObjectives,
  formatActionLabel,
  formatTimeMin,
  isValidHHMM,
  optimizeRecovery,
  parseTimeMin,
  simulateNetwork,
  type FlightNetworkDataset,
  type RecoveryAction,
} from '../index.js';

describe('Dataset integrity (§3)', () => {
  it('matches flight_network.json exactly and satisfies all §3 dataset facts', () => {
    const jsonPath = resolve(process.cwd(), 'flight_network.json');
    const fromJson = JSON.parse(readFileSync(jsonPath, 'utf8')) as FlightNetworkDataset;
    expect(FLIGHT_NETWORK).toEqual(fromJson);

    expect(FLIGHT_NETWORK.meta.min_turnaround_minutes).toBe(30);
    expect(FLIGHT_NETWORK.airports).toHaveLength(16);
    expect(FLIGHT_NETWORK.airports.map((a) => a.id)).toEqual([
      'DEL',
      'BOM',
      'BLR',
      'HYD',
      'MAA',
      'CCU',
      'AMD',
      'COK',
      'GOI',
      'PNQ',
      'JAI',
      'GAU',
      'LKO',
      'IXC',
      'BBI',
      'TRV',
    ]);

    expect(FLIGHT_NETWORK.flights).toHaveLength(70);
    const tails = new Set(FLIGHT_NETWORK.flights.map((f) => f.tail_id));
    expect(tails.size).toBe(16);
    for (let i = 1; i <= 16; i += 1) {
      expect(tails.has(`VT-DS${String(i).padStart(2, '0')}`)).toBe(true);
    }

    expect(FLIGHT_NETWORK.connections).toHaveLength(21);
    expect(FLIGHT_NETWORK.crews).toHaveLength(16);
    for (const crew of FLIGHT_NETWORK.crews) {
      expect(crew.max_duty_mins).toBe(600);
    }

    expect(FLIGHT_NETWORK.spare_aircraft).toEqual([
      { tail_id: 'VT-DS17', base: 'BLR', available_from: '05:00', seats: 180 },
      { tail_id: 'VT-DS18', base: 'DEL', available_from: '05:00', seats: 180 },
    ]);

    const earliestDep = Math.min(...FLIGHT_NETWORK.flights.map((f) => parseTimeMin(f.dep)));
    const latestArr = Math.max(...FLIGHT_NETWORK.flights.map((f) => parseTimeMin(f.arr)));
    expect(formatTimeMin(earliestDep)).toBe('06:00');
    expect(formatTimeMin(latestArr)).toBe('21:45');
  });
});

describe('Time utilities', () => {
  it('validates, parses, and formats HH:MM including past 24:00', () => {
    expect(isValidHHMM('00:00')).toBe(true);
    expect(isValidHHMM('23:59')).toBe(true);
    expect(isValidHHMM('24:00')).toBe(false);
    expect(isValidHHMM('9:30')).toBe(false);
    expect(isValidHHMM('12:60')).toBe(false);

    expect(parseTimeMin('06:00')).toBe(360);
    expect(parseTimeMin('21:45')).toBe(1305);
    expect(() => parseTimeMin('24:00')).toThrow();

    expect(formatTimeMin(0)).toBe('00:00');
    expect(formatTimeMin(360)).toBe('06:00');
    expect(formatTimeMin(1439)).toBe('23:59');
    expect(formatTimeMin(1440)).toBe('00:00 (+1)');
    expect(formatTimeMin(1455)).toBe('00:15 (+1)');
    expect(formatTimeMin(1505)).toBe('01:05 (+1)');
    expect(formatTimeMin(2880)).toBe('00:00 (+2)');
  });
});

describe('11 Golden Tests (§3E)', () => {
  it('Golden #1: none (clear skies)', () => {
    const res = simulateNetwork(FLIGHT_NETWORK, null, []);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.summary.lateFlights).toBe(0);
    expect(res.summary.totalDelayMin).toBe(0);
    expect(res.summary.brokenConnections).toBe(0);
    expect(res.summary.missedConnectionPax).toBe(0);
    expect(res.summary.crewBreaches).toBe(0);
    expect(res.summary.strandedPax).toBe(0);
    expect(res.surge).toBeNull();
  });

  it('Golden #2: BOM 07:30–09:00', () => {
    const res = simulateNetwork(FLIGHT_NETWORK, { airport: 'BOM', start: '07:30', end: '09:00' }, []);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.summary.lateFlights).toBe(16);
    expect(res.summary.totalDelayMin).toBe(755);
    expect(res.summary.brokenConnections).toBe(6);
    expect(res.summary.missedConnectionPax).toBe(199);
    expect(res.summary.strandedPax).toBe(199);
    expect(res.summary.crewBreaches).toBe(0);
  });

  it('Golden #3: DEL 12:00–13:30', () => {
    const res = simulateNetwork(FLIGHT_NETWORK, { airport: 'DEL', start: '12:00', end: '13:30' }, []);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.summary.lateFlights).toBe(10);
    expect(res.summary.totalDelayMin).toBe(680);
    expect(res.summary.brokenConnections).toBe(1);
    expect(res.summary.missedConnectionPax).toBe(18);
    expect(res.summary.crewBreaches).toBe(1);

    const cr03 = res.crews.find((c) => c.crewId === 'CR03');
    expect(cr03?.breached).toBe(true);
    expect(cr03?.overageMin).toBe(50);
  });

  it('Golden #4: BLR 13:00–14:30', () => {
    const res = simulateNetwork(FLIGHT_NETWORK, { airport: 'BLR', start: '13:00', end: '14:30' }, []);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.summary.lateFlights).toBe(8);
    expect(res.summary.totalDelayMin).toBe(295);
    expect(res.summary.brokenConnections).toBe(1);
    expect(res.summary.missedConnectionPax).toBe(45);
    expect(res.summary.crewBreaches).toBe(1);

    const cr08 = res.crews.find((c) => c.crewId === 'CR08');
    expect(cr08?.breached).toBe(true);
    expect(cr08?.overageMin).toBe(10);
  });

  it('Golden #5: CCU 16:00–17:30', () => {
    const res = simulateNetwork(FLIGHT_NETWORK, { airport: 'CCU', start: '16:00', end: '17:30' }, []);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.summary.lateFlights).toBe(3);
    expect(res.summary.totalDelayMin).toBe(195);
    expect(res.summary.brokenConnections).toBe(0);
    expect(res.summary.crewBreaches).toBe(1);

    const cr10 = res.crews.find((c) => c.crewId === 'CR10');
    expect(cr10?.breached).toBe(true);
    expect(cr10?.overageMin).toBe(30);
  });

  it('Golden #6: #3 + SWAP_SPARE(VT-DS18, DS0304)', () => {
    const res = simulateNetwork(
      FLIGHT_NETWORK,
      { airport: 'DEL', start: '12:00', end: '13:30' },
      [{ type: 'SWAP_SPARE', spareTail: 'VT-DS18', flightId: 'DS0304' }]
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.summary.lateFlights).toBe(9);
    expect(res.summary.totalDelayMin).toBe(620);
    expect(res.summary.brokenConnections).toBe(1);
    expect(res.summary.missedConnectionPax).toBe(18);
    expect(res.summary.crewBreaches).toBe(0);

    const ds0304 = res.flights.find((f) => f.flight_id === 'DS0304');
    expect(ds0304?.operatingTail).toBe('VT-DS18');
    expect(ds0304?.isSwapped).toBe(true);
    expect(ds0304?.delayMin).toBe(0);
    expect(ds0304?.status).toBe('recovered');

    const cr03 = res.crews.find((c) => c.crewId === 'CR03');
    expect(cr03?.breached).toBe(false);
    expect(cr03?.operatedFlightIds).toEqual(['DS0301', 'DS0302', 'DS0303']);
  });

  it('Golden #7: #4 + SWAP_SPARE(VT-DS17, DS0802)', () => {
    const res = simulateNetwork(
      FLIGHT_NETWORK,
      { airport: 'BLR', start: '13:00', end: '14:30' },
      [{ type: 'SWAP_SPARE', spareTail: 'VT-DS17', flightId: 'DS0802' }]
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.summary.lateFlights).toBe(7);
    expect(res.summary.totalDelayMin).toBe(175);
    expect(res.summary.brokenConnections).toBe(2);
    expect(res.summary.missedConnectionPax).toBe(68);
    expect(res.summary.crewBreaches).toBe(0);

    const ds0802 = res.flights.find((f) => f.flight_id === 'DS0802');
    expect(ds0802?.actualDepStr).toBe('14:30');
    expect(ds0802?.delayMin).toBe(15);

    const standby = res.crews.find((c) => c.isStandby && c.tailId === 'VT-DS17');
    expect(standby?.dutyStartStr).toBe('13:45');
    expect(standby?.breached).toBe(false);
  });

  it('Golden #8: #5 + CANCEL_TAIL_END(VT-DS10, 1)', () => {
    const res = simulateNetwork(
      FLIGHT_NETWORK,
      { airport: 'CCU', start: '16:00', end: '17:30' },
      [{ type: 'CANCEL_TAIL_END', tailId: 'VT-DS10', count: 1 }]
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.summary.lateFlights).toBe(2);
    expect(res.summary.totalDelayMin).toBe(135);
    expect(res.summary.brokenConnections).toBe(0);
    expect(res.summary.crewBreaches).toBe(0);
    expect(res.summary.cancelledFlights).toBe(1);
    expect(res.summary.cancelledPax).toBe(117);
    expect(res.summary.strandedPax).toBe(117);

    const ds1005 = res.flights.find((f) => f.flight_id === 'DS1005');
    expect(ds1005?.cancelled).toBe(true);
    expect(ds1005?.status).toBe('cancelled');

    const cx21 = res.connections.find((c) => c.connection_id === 'CX21');
    expect(cx21?.status).toBe('cancelled');
  });

  it('Golden #9: #5 + CANCEL_LOOP(DS1003, DS1004)', () => {
    const res = simulateNetwork(
      FLIGHT_NETWORK,
      { airport: 'CCU', start: '16:00', end: '17:30' },
      [{ type: 'CANCEL_LOOP', firstFlightId: 'DS1003', lastFlightId: 'DS1004' }]
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.summary.lateFlights).toBe(0);
    expect(res.summary.totalDelayMin).toBe(0);
    expect(res.summary.brokenConnections).toBe(0);
    expect(res.summary.crewBreaches).toBe(0);
    expect(res.summary.cancelledFlights).toBe(2);
    expect(res.summary.cancelledPax).toBe(278);
    expect(res.summary.strandedPax).toBe(278);

    const ds1005 = res.flights.find((f) => f.flight_id === 'DS1005');
    expect(ds1005?.cancelled).toBe(false);
    expect(ds1005?.delayMin).toBe(0);
  });

  it('Golden #10: #4 + HOLD_CONNECTION(CX12)', () => {
    const res = simulateNetwork(
      FLIGHT_NETWORK,
      { airport: 'BLR', start: '13:00', end: '14:30' },
      [{ type: 'HOLD_CONNECTION', connectionId: 'CX12' }]
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.summary.lateFlights).toBe(8);
    expect(res.summary.totalDelayMin).toBe(310);
    expect(res.summary.brokenConnections).toBe(0);
    expect(res.summary.crewBreaches).toBe(1);

    const cr08 = res.crews.find((c) => c.crewId === 'CR08');
    expect(cr08?.overageMin).toBe(10);

    const ds0504 = res.flights.find((f) => f.flight_id === 'DS0504');
    expect(ds0504?.actualDepStr).toBe('15:15');
    expect(ds0504?.holdDelayMin).toBe(15);
  });

  it('Golden #11: #3 + HOLD_CONNECTION(CX10)', () => {
    const res = simulateNetwork(
      FLIGHT_NETWORK,
      { airport: 'DEL', start: '12:00', end: '13:30' },
      [{ type: 'HOLD_CONNECTION', connectionId: 'CX10' }]
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.summary.lateFlights).toBe(11);
    expect(res.summary.totalDelayMin).toBe(710);
    expect(res.summary.brokenConnections).toBe(0);
    expect(res.summary.crewBreaches).toBe(1);

    const cr03 = res.crews.find((c) => c.crewId === 'CR03');
    expect(cr03?.overageMin).toBe(50);

    const ds0903 = res.flights.find((f) => f.flight_id === 'DS0903');
    expect(ds0903?.actualDepStr).toBe('14:15');
    expect(ds0903?.holdDelayMin).toBe(15);
  });
});

describe('Validation & error codes (§3C)', () => {
  it('returns BREAKS_AIRCRAFT_CONTINUITY for mid-chain or cross-tail loop cancellations', () => {
    const midChain = simulateNetwork(FLIGHT_NETWORK, null, [
      { type: 'CANCEL_LOOP', firstFlightId: 'DS1003', lastFlightId: 'DS1003' },
    ]);
    expect(midChain.ok).toBe(false);
    if (!midChain.ok) {
      expect(midChain.code).toBe('BREAKS_AIRCRAFT_CONTINUITY');
    }

    const nonLoopSpan = simulateNetwork(FLIGHT_NETWORK, null, [
      { type: 'CANCEL_LOOP', firstFlightId: 'DS0302', lastFlightId: 'DS0303' },
    ]);
    expect(nonLoopSpan.ok).toBe(false);
    if (!nonLoopSpan.ok) {
      expect(nonLoopSpan.code).toBe('BREAKS_AIRCRAFT_CONTINUITY');
    }

    const crossTail = simulateNetwork(FLIGHT_NETWORK, null, [
      { type: 'CANCEL_LOOP', firstFlightId: 'DS0301', lastFlightId: 'DS0401' },
    ]);
    expect(crossTail.ok).toBe(false);
    if (!crossTail.ok) {
      expect(crossTail.code).toBe('BREAKS_AIRCRAFT_CONTINUITY');
    }
  });

  it('returns SPARE_WRONG_HUB when spare base does not match flight origin', () => {
    const res = simulateNetwork(FLIGHT_NETWORK, null, [
      { type: 'SWAP_SPARE', spareTail: 'VT-DS17', flightId: 'DS0304' },
    ]);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe('SPARE_WRONG_HUB');
    }
  });

  it('returns SPARE_ALREADY_USED when the same spare is swapped twice', () => {
    const res = simulateNetwork(FLIGHT_NETWORK, null, [
      { type: 'SWAP_SPARE', spareTail: 'VT-DS18', flightId: 'DS0304' },
      { type: 'SWAP_SPARE', spareTail: 'VT-DS18', flightId: 'DS0903' },
    ]);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe('SPARE_ALREADY_USED');
    }
  });

  it('returns FLIGHT_NOT_FOUND for unknown flight IDs', () => {
    const swapMissing = simulateNetwork(FLIGHT_NETWORK, null, [
      { type: 'SWAP_SPARE', spareTail: 'VT-DS18', flightId: 'DS9999' },
    ]);
    expect(swapMissing.ok).toBe(false);
    if (!swapMissing.ok) {
      expect(swapMissing.code).toBe('FLIGHT_NOT_FOUND');
    }

    const loopMissing = simulateNetwork(FLIGHT_NETWORK, null, [
      { type: 'CANCEL_LOOP', firstFlightId: 'DS9999', lastFlightId: 'DS0304' },
    ]);
    expect(loopMissing.ok).toBe(false);
    if (!loopMissing.ok) {
      expect(loopMissing.code).toBe('FLIGHT_NOT_FOUND');
    }
  });

  it('returns INVALID_ACTION for invalid action arguments or closures', () => {
    const badCount = simulateNetwork(FLIGHT_NETWORK, null, [
      { type: 'CANCEL_TAIL_END', tailId: 'VT-DS10', count: 0 },
    ]);
    expect(badCount.ok).toBe(false);
    if (!badCount.ok) expect(badCount.code).toBe('INVALID_ACTION');

    const badConn = simulateNetwork(FLIGHT_NETWORK, null, [
      { type: 'HOLD_CONNECTION', connectionId: 'CX99' },
    ]);
    expect(badConn.ok).toBe(false);
    if (!badConn.ok) expect(badConn.code).toBe('INVALID_ACTION');

    const holdCancelled = simulateNetwork(FLIGHT_NETWORK, null, [
      { type: 'CANCEL_TAIL_END', tailId: 'VT-DS10', count: 1 },
      { type: 'HOLD_CONNECTION', connectionId: 'CX21' },
    ]);
    expect(holdCancelled.ok).toBe(false);
    if (!holdCancelled.ok) expect(holdCancelled.code).toBe('INVALID_ACTION');

    const badClosure = simulateNetwork(FLIGHT_NETWORK, { airport: 'XYZ', start: '08:00', end: '09:00' }, []);
    expect(badClosure.ok).toBe(false);
    if (!badClosure.ok) expect(badClosure.code).toBe('INVALID_ACTION');
  });
});

describe('Determinism, causeSteps, surge, and optimizer', () => {
  it('is strictly deterministic and does not mutate input data', () => {
    const snapshotBefore = JSON.stringify(FLIGHT_NETWORK);
    const closure = { airport: 'DEL', start: '12:00', end: '13:30' };
    const actions: RecoveryAction[] = [{ type: 'HOLD_CONNECTION', connectionId: 'CX10' }];

    const simA = simulateNetwork(FLIGHT_NETWORK, closure, actions);
    const simB = simulateNetwork(FLIGHT_NETWORK, closure, actions);
    expect(simA).toEqual(simB);

    const optA = compareObjectives(FLIGHT_NETWORK, closure, []);
    const optB = compareObjectives(FLIGHT_NETWORK, closure, []);
    expect(optA).toEqual(optB);

    expect(JSON.stringify(FLIGHT_NETWORK)).toBe(snapshotBefore);
  });

  it('produces non-empty causeSteps tracing closure/hold, absorbed turnaround, and carried delay', () => {
    const bom = simulateNetwork(FLIGHT_NETWORK, { airport: 'BOM', start: '07:30', end: '09:00' }, []);
    expect(bom.ok).toBe(true);
    if (!bom.ok) return;

    for (const f of bom.flights) {
      if (!f.cancelled && f.delayMin > 0) {
        expect(f.causeSteps.length).toBeGreaterThan(0);
        expect(f.causeSummary.length).toBeGreaterThan(0);
      }
    }

    const ds0702 = bom.flights.find((f) => f.flight_id === 'DS0702');
    expect(ds0702?.causeSteps[0]).toContain('BOM closed 07:30–09:00');
    expect(ds0702?.causeSteps[0]).toContain('DS0701');
    expect(ds0702?.causeSteps.some((s) => s.includes('absorbed 45m'))).toBe(true);
    expect(ds0702?.causeSteps.some((s) => s.includes('+20m carried to DS0702'))).toBe(true);

    expect(bom.surge).not.toBeNull();
    expect(bom.surge?.movements).toBe(10);
    expect(bom.surge?.capacityPerHour).toBe(32);

    const delHold = simulateNetwork(
      FLIGHT_NETWORK,
      { airport: 'DEL', start: '12:00', end: '13:30' },
      [{ type: 'HOLD_CONNECTION', connectionId: 'CX10' }]
    );
    expect(delHold.ok).toBe(true);
    if (!delHold.ok) return;

    const ds0903 = delHold.flights.find((f) => f.flight_id === 'DS0903');
    expect(ds0903?.causeSteps.some((s) => s.includes('CX10'))).toBe(true);
  });

  it('ranks recoveries strictly by objective and computes sideEffects by diffing simulations', () => {
    const blr = { airport: 'BLR', start: '13:00', end: '14:30' };
    const compared = compareObjectives(FLIGHT_NETWORK, blr, []);

    const swapOnly = compared.compliance.find(
      (r) =>
        r.actions.length === 1 &&
        r.actions[0].type === 'SWAP_SPARE' &&
        r.actions[0].spareTail === 'VT-DS17' &&
        r.actions[0].flightId === 'DS0802'
    );
    expect(swapOnly).toBeDefined();
    expect(swapOnly?.diff.clearedCrews).toEqual(['CR08']);
    expect(swapOnly?.diff.newlyBrokenConnections).toEqual([{ connection_id: 'CX17', passengers: 23 }]);
    expect(swapOnly?.sideEffects).toContain('clears CR08');
    expect(swapOnly?.sideEffects).toContain('breaks CX17 for 23 pax');

    // Incremental baseActions: after SWAP_SPARE(VT-DS17, DS0802), optimizer recommends holding CX12.
    const followUp = optimizeRecovery(FLIGHT_NETWORK, blr, 'passengers', [
      { type: 'SWAP_SPARE', spareTail: 'VT-DS17', flightId: 'DS0802' },
    ]);
    expect(followUp[0]?.actions).toEqual([{ type: 'HOLD_CONNECTION', connectionId: 'CX12' }]);
    expect(followUp[0]?.diff.savedConnections).toEqual([{ connection_id: 'CX12', passengers: 45 }]);

    // Compliance top recommendation clears CR08 and holds CX12 to cut stranded pax from 68 -> 23.
    const topCompliance = compared.compliance[0];
    expect(topCompliance.summary.crewBreaches).toBe(0);
    expect(topCompliance.summary.strandedPax).toBe(23);
    expect(topCompliance.actions).toEqual([
      { type: 'SWAP_SPARE', spareTail: 'VT-DS17', flightId: 'DS0802' },
      { type: 'HOLD_CONNECTION', connectionId: 'CX12' },
    ]);

    // Verify objective sorting order invariants across all 3 lists.
    for (let i = 1; i < compared.compliance.length; i += 1) {
      const prev = compared.compliance[i - 1].summary;
      const curr = compared.compliance[i].summary;
      const ordered =
        prev.crewBreaches < curr.crewBreaches ||
        (prev.crewBreaches === curr.crewBreaches && prev.strandedPax < curr.strandedPax) ||
        (prev.crewBreaches === curr.crewBreaches &&
          prev.strandedPax === curr.strandedPax &&
          prev.totalDelayMin <= curr.totalDelayMin);
      expect(ordered).toBe(true);
    }

    for (let i = 1; i < compared.passengers.length; i += 1) {
      const prev = compared.passengers[i - 1].summary;
      const curr = compared.passengers[i].summary;
      const ordered =
        prev.strandedPax < curr.strandedPax ||
        (prev.strandedPax === curr.strandedPax && prev.crewBreaches < curr.crewBreaches) ||
        (prev.strandedPax === curr.strandedPax &&
          prev.crewBreaches === curr.crewBreaches &&
          prev.totalDelayMin <= curr.totalDelayMin);
      expect(ordered).toBe(true);
    }

    for (let i = 1; i < compared.delay.length; i += 1) {
      const prev = compared.delay[i - 1].summary;
      const curr = compared.delay[i].summary;
      const ordered =
        prev.totalDelayMin < curr.totalDelayMin ||
        (prev.totalDelayMin === curr.totalDelayMin && prev.crewBreaches < curr.crewBreaches) ||
        (prev.totalDelayMin === curr.totalDelayMin &&
          prev.crewBreaches === curr.crewBreaches &&
          prev.strandedPax <= curr.strandedPax);
      expect(ordered).toBe(true);
    }

    // DEL 12:00-13:30: pair SWAP_SPARE(VT-DS18, DS0304) + HOLD_CONNECTION(CX10) clears both CR03 and CX10.
    const delCompliance = optimizeRecovery(
      FLIGHT_NETWORK,
      { airport: 'DEL', start: '12:00', end: '13:30' },
      'compliance',
      []
    );
    expect(delCompliance[0].summary.crewBreaches).toBe(0);
    expect(delCompliance[0].summary.strandedPax).toBe(0);
    expect(delCompliance[0].summary.totalDelayMin).toBe(650);

    // Clear skies yields no recommendations.
    expect(optimizeRecovery(FLIGHT_NETWORK, null, 'compliance', [])).toEqual([]);

    // Format labels for all 4 action types.
    expect(formatActionLabel({ type: 'SWAP_SPARE', spareTail: 'VT-DS18', flightId: 'DS0304' })).toContain(
      'VT-DS18'
    );
    expect(formatActionLabel({ type: 'CANCEL_TAIL_END', tailId: 'VT-DS10', count: 1 })).toContain(
      'VT-DS10'
    );
    expect(
      formatActionLabel({ type: 'CANCEL_LOOP', firstFlightId: 'DS1003', lastFlightId: 'DS1004' })
    ).toContain('DS1003');
    expect(formatActionLabel({ type: 'HOLD_CONNECTION', connectionId: 'CX12' })).toContain('CX12');
  });
});
