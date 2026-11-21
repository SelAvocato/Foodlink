"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  SCAN_TIMEOUT_MS,
  inspectionPath,
  isRetryable,
  scanCopy,
  stateFromResponse,
  tokenFromHash,
  type ScanState,
} from "./scan-logic";

export function ScanView() {
  const router = useRouter();
  const [state, setState] = useState<ScanState>({ kind: "idle" });
  // The hash is cleared before the request, so a retry must read the token here.
  const tokenRef = useRef<string | null>(null);
  // Only the newest attempt may change the screen or navigate.
  const runRef = useRef(0);
  // False once the page is closed, so a late answer cannot move the volunteer.
  const mountedRef = useRef(false);

  const submit = useCallback(
    async (token: string) => {
      runRef.current += 1;
      const mine = runRef.current;
      setState({ kind: "scanning" });

      let next: ScanState;
      try {
        const response = await fetch("/api/volunteer/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
          cache: "no-store",
          signal: AbortSignal.timeout(SCAN_TIMEOUT_MS),
        });
        // A body that is not JSON still has a status worth mapping.
        const body: unknown = await response.json().catch(() => null);
        next = stateFromResponse(response.status, body);
      } catch {
        // Offline, timeout, or an aborted request: the token is still in memory.
        next = { kind: "networkError" };
      }

      if (runRef.current !== mine) return;
      setState(next);
      if (next.kind === "goInspection") router.replace(inspectionPath(next.donationId));
    },
    [router],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      // Closing the page invalidates any scan still in flight.
      mountedRef.current = false;
      runRef.current += 1;
    };
  }, []);

  useEffect(() => {
    // StrictMode runs this effect twice; the ref keeps it to one submission.
    if (tokenRef.current !== null) return;
    const token = tokenFromHash(window.location.hash);
    if (token === null) return;
    // Drop the spent token from the address bar and from history before asking.
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    tokenRef.current = token;
    // The microtask keeps the first state write out of the effect body.
    void Promise.resolve().then(() => {
      if (mountedRef.current) void submit(token);
    });
  }, [submit]);

  function retryScan() {
    // The address bar no longer holds the token, so a retry reads it from memory.
    const token = tokenRef.current;
    if (token !== null) void submit(token);
  }

  const copy = scanCopy(state);
  // Only an unreachable server offers a retry, and that state only follows a scan.
  const canRetry = isRetryable(state);

  return (
    <div className="mx-auto w-full max-w-md px-5 py-6">
      <h1 className="text-[28px] font-semibold leading-tight text-[#17261F]">Scan pickup QR</h1>
      <p className="mt-2 text-[15px] text-[#63746D]">Step 1 of 3 · Pickup verification</p>

      <div className="relative mt-9 h-[353px] w-full rounded-2xl bg-[#1D3029]">
        <p className="absolute left-[22px] top-[22px] pr-4 text-[15px] text-white">
          Point the camera at the donor’s QR label
        </p>
        <div className="absolute left-1/2 top-[90px] size-[220px] -translate-x-1/2 rounded-3xl border-2 border-[#D6E8DD]">
          <div className="absolute inset-x-[19px] top-1/2 h-0.5 bg-[#D6E8DD]" />
        </div>
        <p className="absolute bottom-[22px] left-[22px] text-[13px] text-white">Camera preview</p>
      </div>

      <div className="mt-6 rounded-xl bg-[#EAF4EE] px-5 py-5 text-[15px] leading-6 text-[#176448]">
        The QR must belong to your assigned task and the pickup window must not have expired.
      </div>

      {copy !== null ? (
        <div
          role={copy.tone === "error" ? "alert" : "status"}
          className={
            copy.tone === "error"
              ? "mt-6 rounded-xl bg-[#EAF4EE] px-5 py-5 text-[15px] leading-6 text-[#885B16]"
              : "mt-6 rounded-xl bg-[#EAF4EE] px-5 py-5 text-[15px] leading-6 text-[#176448]"
          }
        >
          {copy.title !== null ? <p className="font-semibold">{copy.title}</p> : null}
          {copy.body !== null ? (
            <p className={copy.title !== null ? "mt-1" : undefined}>{copy.body}</p>
          ) : null}
          {canRetry ? (
            <button
              type="button"
              onClick={retryScan}
              className="mt-3 inline-flex h-11 items-center justify-center rounded-sm border border-[#885B16] px-5 text-[15px] font-semibold text-[#885B16] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#885B16]"
            >
              Try again
            </button>
          ) : null}
        </div>
      ) : null}

      <button
        type="button"
        disabled
        className="mt-9 inline-flex h-12 w-full items-center justify-center rounded-sm bg-[#176448] px-6 text-[15px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        Enable camera
      </button>
      <p className="mt-5 text-[15px] text-[#63746D]">Camera access is required to scan.</p>
    </div>
  );
}
