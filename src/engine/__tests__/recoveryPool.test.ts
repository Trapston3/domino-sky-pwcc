import { describe, expect, it } from 'vitest';
import { FLIGHT_NETWORK } from '../../data/flightNetwork.js';
import { compareObjectives, evaluateRecoveryPool, rankRecoveryPool } from '../index.js';

describe('reusable recovery candidate pool', () => {
  it('matches compareObjectives when one evaluated pool is ranked for each objective', () => {
    const closure = { airport: 'BLR', start: '13:00', end: '14:30' } as const;
    const pool = evaluateRecoveryPool(FLIGHT_NETWORK, closure, []);
    const direct = compareObjectives(FLIGHT_NETWORK, closure, []);

    expect(rankRecoveryPool(pool, 'compliance')).toEqual(direct.compliance);
    expect(rankRecoveryPool(pool, 'passengers')).toEqual(direct.passengers);
    expect(rankRecoveryPool(pool, 'delay')).toEqual(direct.delay);
  });
});
