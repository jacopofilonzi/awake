import type { AgentResult, ApiErrorBody, ErrorCode } from "@awake/shared";

/** An error that becomes an HTTP response `{ error: code, field?, results? }`. */
export class ApiError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 429 | 500 | 502,
    readonly code: ErrorCode,
    readonly field?: string,
    readonly results?: AgentResult[],
  ) {
    super(code);
  }

  toBody(): ApiErrorBody {
    return {
      error: this.code,
      ...(this.field ? { field: this.field } : {}),
      ...(this.results ? { results: this.results } : {}),
    };
  }
}
