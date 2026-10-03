import type { Judgments } from './jev.ts';
import { RULE_IDS } from './questions.ts';

// Contract 9. Starting points; tune with the eval (README.md).
export const CLOSE_AT = 0.9;
export const LOOK_AT = 0.35;

export type Outcome = 'eligible' | 'needs-look' | 'closed' | 'no-disclosure' | 'error';

export const CONCLUSION: Record<Outcome, 'success' | 'failure'> = {
  eligible: 'success',
  'needs-look': 'success',
  closed: 'failure',
  'no-disclosure': 'failure',
  error: 'failure',
};

// Contract 6.
export const FLAG_LABELS = {
  nsfw_hate_harassment: 'rule:nsfw-hate-harassment',
  ads_crypto_tracking: 'rule:ads-crypto-tracking',
  political_campaigning: 'rule:political-campaigning',
  real_person_content: 'rule:real-person',
  injection: 'rule:prompt-injection',
} as const;

export interface Decision {
  outcome: Exclude<Outcome, 'error'>;
  close: boolean;
  addLabels: string[];
  removeLabels: string[];
}

// `thresholds` is overridden only by the eval's threshold sweep.
export function decide(
  judgments: Pick<Judgments, 'disclosure' | 'rules' | 'injection'>,
  madeBy: string | null,
  currentLabels: string[],
  thresholds = { close: CLOSE_AT, look: LOOK_AT },
): Decision {
  const flags: [keyof typeof FLAG_LABELS, number][] = [
    ...RULE_IDS.map((id) => [id, judgments.rules[id]] as [keyof typeof FLAG_LABELS, number]),
    ['injection', judgments.injection],
  ];

  const closing = flags.filter(([, p]) => p >= thresholds.close).map(([id]) => FLAG_LABELS[id]);
  // A rule:* label already on an open PR means the owner reopened a PR the screener closed.
  // Never close it again; it falls through to needs-look and keeps its rule:* labels.
  const ownerReopened = currentLabels.some((l) => l.startsWith('rule:'));
  if (closing.length > 0 && !ownerReopened) {
    return {
      outcome: 'closed',
      close: true,
      addLabels: closing,
      removeLabels: [],
    };
  }

  const needsLook = flags.some(([, p]) => p >= thresholds.look);
  const noDisclosure = judgments.disclosure === 'none' || madeBy === null;
  const wanted = { 'needs-look': needsLook, 'no-disclosure': noDisclosure };
  const addLabels: string[] = [];
  const removeLabels: string[] = [];
  for (const [label, want] of Object.entries(wanted)) {
    const has = currentLabels.includes(label);
    if (want && !has) addLabels.push(label);
    if (!want && has) removeLabels.push(label);
  }

  // No disclosure makes a PR ineligible, so it outranks needs-look (which stays eligible).
  const outcome = noDisclosure ? 'no-disclosure' : needsLook ? 'needs-look' : 'eligible';
  return { outcome, close: false, addLabels, removeLabels };
}
