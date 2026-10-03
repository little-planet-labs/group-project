import { describe, expect, it } from 'vitest';
import { decide } from '../src/policy.ts';

const clean = {
  disclosure: 'names_agent' as const,
  rules: { nsfw_hate_harassment: 0, ads_crypto_tracking: 0, political_campaigning: 0, real_person_content: 0 },
  injection: 0,
};

function withFlag(flag: string, p: number) {
  return flag === 'injection' ? { ...clean, injection: p } : { ...clean, rules: { ...clean.rules, [flag]: p } };
}

describe('policy', () => {
  it('policy_threshold_boundaries', () => {
    const flags = ['nsfw_hate_harassment', 'ads_crypto_tracking', 'political_campaigning', 'real_person_content', 'injection'];
    for (const flag of flags) {
      expect(decide(withFlag(flag, 0.9), 'Claude', []).outcome, flag).toBe('closed');
      expect(decide(withFlag(flag, 0.9), 'Claude', []).close, flag).toBe(true);
      expect(decide(withFlag(flag, 0.8999), 'Claude', []), flag).toMatchObject({ outcome: 'needs-look', close: false, addLabels: ['needs-look'] });
      expect(decide(withFlag(flag, 0.35), 'Claude', []), flag).toMatchObject({ outcome: 'needs-look', close: false });
      expect(decide(withFlag(flag, 0.3499), 'Claude', []), flag).toEqual({ outcome: 'eligible', close: false, addLabels: [], removeLabels: [] });
    }
    expect(decide(withFlag('injection', 0.9), 'Claude', []).addLabels).toEqual(['rule:prompt-injection']);
    expect(decide(withFlag('real_person_content', 0.95), 'Claude', []).addLabels).toEqual(['rule:real-person']);
  });

  it('policy_no_disclosure_is_ineligible_not_closed', () => {
    expect(decide({ ...clean, disclosure: 'none' }, 'Claude', [])).toEqual({
      outcome: 'no-disclosure', close: false, addLabels: ['no-disclosure'], removeLabels: [],
    });
    expect(decide(clean, null, [])).toMatchObject({ outcome: 'no-disclosure', close: false });
    // Both flags apply: both labels, and ineligibility wins the outcome.
    expect(decide({ ...withFlag('injection', 0.5), disclosure: 'none' }, 'Claude', [])).toEqual({
      outcome: 'no-disclosure', close: false, addLabels: ['needs-look', 'no-disclosure'], removeLabels: [],
    });
    // A rule violation still closes regardless of disclosure.
    expect(decide({ ...withFlag('ads_crypto_tracking', 0.95), disclosure: 'none' }, null, []).outcome).toBe('closed');
  });

  it('rescreen_removes_stale_labels', () => {
    expect(decide(clean, 'human', ['needs-look', 'no-disclosure', 'wanted'])).toEqual({
      outcome: 'eligible', close: false, addLabels: [], removeLabels: ['needs-look', 'no-disclosure'],
    });
    // A label that still applies is neither re-added nor removed.
    expect(decide(withFlag('injection', 0.5), 'human', ['needs-look', 'no-disclosure'])).toEqual({
      outcome: 'needs-look', close: false, addLabels: [], removeLabels: ['no-disclosure'],
    });
  });
});
