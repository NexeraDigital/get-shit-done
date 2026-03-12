import { describe, it, expect } from 'vitest';
import { parseDependsOn } from '../parse-depends-on.js';

describe('parseDependsOn', () => {
  it('returns [] for null', () => {
    expect(parseDependsOn(null)).toEqual([]);
  });

  it('returns [] for empty string', () => {
    expect(parseDependsOn('')).toEqual([]);
  });

  it('returns [] for "Nothing"', () => {
    expect(parseDependsOn('Nothing')).toEqual([]);
  });

  it('returns [] for "Nothing (first phase)"', () => {
    expect(parseDependsOn('Nothing (first phase)')).toEqual([]);
  });

  it('parses "Phase 1" to [1]', () => {
    expect(parseDependsOn('Phase 1')).toEqual([1]);
  });

  it('parses "Phase 1, Phase 2" to [1, 2]', () => {
    expect(parseDependsOn('Phase 1, Phase 2')).toEqual([1, 2]);
  });

  it('parses "Phase 1 and Phase 3" to [1, 3]', () => {
    expect(parseDependsOn('Phase 1 and Phase 3')).toEqual([1, 3]);
  });

  it('parses "Phases 1, 2" to [1, 2]', () => {
    expect(parseDependsOn('Phases 1, 2')).toEqual([1, 2]);
  });

  it('parses decimal phase numbers like "Phase 2.1" to [2.1]', () => {
    expect(parseDependsOn('Phase 2.1')).toEqual([2.1]);
  });

  it('parses mixed integer and decimal "Phase 1, Phase 2.1, Phase 3" to [1, 2.1, 3]', () => {
    expect(parseDependsOn('Phase 1, Phase 2.1, Phase 3')).toEqual([1, 2.1, 3]);
  });

  it('deduplicates repeated phase numbers', () => {
    expect(parseDependsOn('Phase 1, Phase 1')).toEqual([1]);
  });

  it('deduplicates repeated decimal phase numbers', () => {
    expect(parseDependsOn('Phase 2.1, Phase 2.1')).toEqual([2.1]);
  });
});
