// Shared POS error factory. Every POS-CAP-00x capability file throws
// through this (never a bare `new Error(...)`) so every POS failure
// carries the same { status, code } shape the HTTP layer (errorResponse)
// and the test suites already depend on.
export function posError(status, message, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}
