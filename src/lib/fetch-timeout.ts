/**
 * Wraps a fetch implementation so every request has a deadline while a caller abort still
 * cancels the call. The caller's signal is taken from `init.signal` when it is set (null means
 * none), otherwise from the Request input, and is combined with the timeout.
 * No environment, server-only or Supabase imports: the caller passes its own fetch and
 * timeout, which keeps this testable with a fake fetch.
 */
export function withTimeout(baseFetch: typeof fetch, ms: number): typeof fetch {
  return (input, init) => {
    const timeoutSignal = AbortSignal.timeout(ms);
    // Precedence matches fetch: an explicit init.signal wins (null means no caller signal),
    // otherwise a Request input brings its own signal.
    const callerSignal =
      init !== undefined && init.signal !== undefined ? init.signal : input instanceof Request ? input.signal : undefined;
    const signal = callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal;
    return baseFetch(input, init ? { ...init, signal } : { signal });
  };
}
