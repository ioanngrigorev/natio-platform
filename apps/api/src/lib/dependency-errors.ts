/** Only transport/availability failures become 503. Integrity violations and
 * programming errors remain 500; SQL text and connection details never reach UI.
 * Drizzle wraps pg failures in `cause`, so classification follows that chain.
 */
export function isDependencyUnavailable(error: unknown): boolean {
  const codes = new Set(['ECONNREFUSED','ECONNRESET','ETIMEDOUT','EPIPE','ENOTFOUND','08001','08003','08006','53300','57P01','57P02','57P03']);
  let current = error;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth++) {
    const candidate = current as {code?: string; message?: string; cause?: unknown};
    if (candidate.code && codes.has(candidate.code)) return true;
    if (['timeout exceeded when trying to connect', 'Connection is closed.', "Stream isn't writeable and enableOfflineQueue options is false", 'Command timed out'].includes(candidate.message ?? '')) return true;
    current = candidate.cause;
  }
  return false;
}
