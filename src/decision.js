// Initial design thresholds, not calibrated production thresholds.
export const INITIAL_THRESHOLDS = Object.freeze({ realMax: 0.2, aiMin: 0.8 });

export function classifyProbability(probability, thresholds = INITIAL_THRESHOLDS) {
  const { realMax, aiMin } = thresholds;
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new RangeError('AI probability must be a finite number between 0 and 1.');
  }
  if (!Number.isFinite(realMax) || !Number.isFinite(aiMin) || realMax < 0 || aiMin > 1 || realMax >= aiMin) {
    throw new RangeError('Thresholds must satisfy 0 <= realMax < aiMin <= 1.');
  }
  if (probability >= aiMin) return { label: 'AI', title: 'AI 생성 의심', decision: 'warning' };
  if (probability <= realMax) return { label: 'REAL', title: '실제 이미지 추정', decision: 'normal' };
  return { label: 'UNKNOWN', title: '판별 불확실', decision: 'uncertain' };
}
