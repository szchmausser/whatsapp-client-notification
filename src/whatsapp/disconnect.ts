export function shouldRetryDisconnect(statusCode: number | undefined): boolean {
  if (statusCode === undefined) return true;

  const retryable = new Set([408, 428, 500, 503]);
  return retryable.has(statusCode);
}
