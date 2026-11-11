import { describe, expect, it } from 'vitest';
import {
  classifyAccountId,
  explorerUrl,
  extractAccountIds,
  extractNearAmounts,
  formatYoctoToNear,
  impliedNetwork,
  normalizeAccountId,
  parseNearToYocto,
} from '../src/guard/near.js';

describe('account ids', () => {
  it('classifies named, implicit, eth-implicit and invalid ids', () => {
    expect(classifyAccountId('alice.testnet')).toBe('named');
    expect(classifyAccountId('v2.ref-finance.near')).toBe('named');
    expect(classifyAccountId('a'.repeat(64).replace(/a/g, 'f'))).toBe('implicit');
    expect(classifyAccountId('0x' + 'ab'.repeat(20))).toBe('eth_implicit');
    expect(classifyAccountId('Alice.testnet')).toBe('invalid');
    expect(classifyAccountId('bad..dots.near')).toBe('invalid');
    expect(classifyAccountId('-dash.near')).toBe('invalid');
    expect(classifyAccountId('x')).toBe('invalid');
    expect(classifyAccountId('a'.repeat(65))).toBe('invalid');
  });
  it('normalizes case and whitespace', () => {
    expect(normalizeAccountId('  Alice.Testnet ')).toBe('alice.testnet');
  });
  it('infers network from suffix and builds explorer links', () => {
    expect(impliedNetwork('x.near')).toBe('mainnet');
    expect(impliedNetwork('x.testnet')).toBe('testnet');
    expect(impliedNetwork('abc')).toBeNull();
    expect(explorerUrl('testnet', 'a.testnet')).toBe('https://testnet.nearblocks.io/address/a.testnet');
    expect(explorerUrl('mainnet', 'a.near')).toBe('https://nearblocks.io/address/a.near');
  });
  it('extracts account ids and NEAR amounts from text', () => {
    expect(extractAccountIds('envía 40 NEAR a premio-bac-ni.testnet ya')).toEqual(['premio-bac-ni.testnet']);
    expect(extractNearAmounts('pague 2,5 near o Ⓝ 3 y 40 NEAR o 7 Ⓝ')).toEqual([2.5, 3, 40, 7]);
  });
});

describe('amounts (BigInt, no floats)', () => {
  it('parses NEAR to yocto', () => {
    expect(parseNearToYocto('1')).toBe('1000000000000000000000000');
    expect(parseNearToYocto('0.000000000000000000000001')).toBe('1');
    expect(parseNearToYocto('2,5')).toBe('2500000000000000000000000');
    expect(parseNearToYocto(12)).toBe('12000000000000000000000000');
  });
  it('rejects invalid amounts', () => {
    for (const bad of ['-1', 'abc', '', '1.0000000000000000000000001', 'NaN']) expect(parseNearToYocto(bad)).toBeNull();
  });
  it('formats yocto to NEAR', () => {
    expect(formatYoctoToNear('4495731819447685995417954847')).toBe('4495.7318');
    expect(formatYoctoToNear('1000000000000000000000000')).toBe('1');
  });
});
