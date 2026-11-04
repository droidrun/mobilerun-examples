/** What the browser and this server exchange. Mobilerun task ids stay on the server. */

/** `unknown`: the API did not confirm the start; the server is checking. */
export type RunStatus =
  | 'starting' | 'running' | 'cancelling' | 'unknown' | 'completed' | 'failed' | 'cancelled';
export const isTerminal = (status: RunStatus) =>
  status === 'completed' || status === 'failed' || status === 'cancelled';

export type TimelineEntry = { at: string; kind: 'status' | 'user'; text: string };
/** Validated output: found values in schema order, and the labels of the ones not found. */
export type Result = {
  rows: Array<{ label: string; value: string | Array<string> }>;
  missing: Array<string>;
};

export type RunView = {
  id: string; presetId: string; request: string; status: RunStatus; steps: number | null;
  timeline: Array<TimelineEntry>; message: string | null; createdAt: string;
  /** Only when the output matched the preset's schema; otherwise `rawOutput` (capped JSON). */
  result: Result | null; rawOutput: string | null;
  /** Set while the server cannot reach the backend for this run. */
  error: string | null;
  /** Credits charged once the run settles, and the user's balance. */
  charged: number | null; balance: number;
};

export type SessionView = {
  persona: { name: string; role: string };
  presets: Array<{ id: string; label: string; hint: string }>;
  balance: number; reservePerRun: number;
  /** The user's latest run, active or not. */
  run: RunView | null;
};

export type ErrorBody = { error: string; message: string };
