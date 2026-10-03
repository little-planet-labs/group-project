import raw from '$lib/generated/history.json';

/** One merged PR. scripts/ci/fetch-history.mjs writes these before the production build. */
export type HistoryEntry = {
	number: number;
	title: string;
	url: string;
	mergedAt: string;
	madeBy: string | null;
	rationale: string | null;
};

/** Merged PRs, newest first. */
export const history: HistoryEntry[] = (raw as HistoryEntry[]).toSorted((a, b) =>
	Date.parse(b.mergedAt) - Date.parse(a.mergedAt)
);
