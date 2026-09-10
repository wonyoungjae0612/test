import { test, expect } from '@playwright/test';
import { classifyProbability } from '../src/decision.js';

test('design boundaries preserve the UNKNOWN interval', () => {
  for (const [probability, label] of [[0, 'REAL'], [0.2, 'REAL'], [0.200001, 'UNKNOWN'], [0.72, 'UNKNOWN'], [0.799999, 'UNKNOWN'], [0.8, 'AI'], [1, 'AI']]) {
    expect(classifyProbability(probability).label).toBe(label);
  }
});

test('invalid scores and thresholds never produce a prediction', () => {
  for (const probability of [NaN, Infinity, -0.1, 1.1, '0.9', null]) {
    expect(() => classifyProbability(probability)).toThrow(RangeError);
  }
  expect(() => classifyProbability(0.5, { realMax: 0.8, aiMin: 0.2 })).toThrow(RangeError);
  expect(classifyProbability(0.85, { realMax: 0.1, aiMin: 0.9 }).label).toBe('UNKNOWN');
});
