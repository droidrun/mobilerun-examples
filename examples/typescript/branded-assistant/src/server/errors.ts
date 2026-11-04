/** An error with a stable code and HTTP status that is safe to show to end users. */
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

/** An error returned by the Mobilerun API, kept free of SDK types. */
export class UpstreamError extends Error {
  readonly status: number | undefined;

  constructor(status: number | undefined, message: string) {
    super(message);
    this.name = 'UpstreamError';
    this.status = status;
  }
}

/**
 * Render an upstream API error as returned (4xx / 422, e.g. an unavailable
 * device or insufficient balance). Credential problems on the server's own key
 * and upstream outages are not the end user's to fix, so they become a 502.
 */
export function problemFromUpstream(error: UpstreamError): ApiProblem {
  const status = error.status;
  if (status !== undefined && status >= 400 && status < 500) {
    if (status === 401 || status === 403) {
      return new ApiProblem(
        502,
        'upstream_unauthorized',
        'The assistant backend rejected the server credentials.',
      );
    }
    return new ApiProblem(status, 'upstream_error', error.message);
  }
  return new ApiProblem(
    502,
    'upstream_unavailable',
    'The assistant backend is unavailable. Try again shortly.',
  );
}
