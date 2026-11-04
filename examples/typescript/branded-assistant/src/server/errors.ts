/** A domain error with a stable code and HTTP status that is safe to show to end users. */
export class ApiProblem extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiProblem';
    this.status = status;
    this.code = code;
  }
}

/** The HTTP status of an SDK error (or anything shaped like one), if it has one. */
export function statusOf(error: unknown): number | undefined {
  return typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number'
    ? error.status
    : undefined;
}

/**
 * The API definitely did not accept the request: a 4xx other than a request
 * timeout. Timeouts, 5xx and network failures are ambiguous: the task may exist.
 */
export function isDefiniteRejection(error: unknown): boolean {
  const status = statusOf(error);
  return status !== undefined && status >= 400 && status < 500 && status !== 408;
}
