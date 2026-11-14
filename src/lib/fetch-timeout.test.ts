import { describe, expect, it } from "vitest";
import { withTimeout } from "./fetch-timeout";

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

/** A fake fetch that records what it was called with. No network. */
function recordingFetch(impl: (input: FetchInput, init: FetchInit) => Promise<Response>) {
  const calls: Array<{ input: FetchInput; init: FetchInit }> = [];
  const base = ((input: FetchInput, init?: FetchInit) => {
    calls.push({ input, init });
    return impl(input, init);
  }) as typeof fetch;
  return { base, calls };
}

/** Never settles on its own; rejects with the signal's reason when the signal aborts, like real fetch. */
function hungFetch() {
  return recordingFetch(
    (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return;
        if (signal.aborted) {
          reject(signal.reason);
          return;
        }
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
  );
}

/** The rejection reason of a call, or undefined when it resolved. */
function outcome(call: Promise<Response>): Promise<unknown> {
  return call.then(
    () => undefined,
    (reason: unknown) => reason,
  );
}

describe("withTimeout", () => {
  it("passes the url and init through and returns the base fetch's response", async () => {
    const response = { ok: true, status: 200 } as Response;
    const { base, calls } = recordingFetch(async () => response);
    await expect(withTimeout(base, 5_000)("https://example.test/x", { method: "POST" })).resolves.toBe(response);
    expect(calls).toHaveLength(1);
    expect(calls[0].input).toBe("https://example.test/x");
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("aborts the signal given to the base fetch after ms", async () => {
    const { base, calls } = hungFetch();
    const call = withTimeout(base, 15)("https://example.test/hang");
    const signal = calls[0].init?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
    await new Promise<void>((resolve, reject) => {
      signal?.addEventListener("abort", () => resolve(), { once: true });
      setTimeout(() => reject(new Error("signal was never aborted")), 3_000);
    });
    expect(signal?.aborted).toBe(true);
    expect(await outcome(call)).toBeInstanceOf(Error);
  });

  it("rejects a hung call with a TimeoutError after the timeout", async () => {
    const { base } = hungFetch();
    const startedAt = Date.now();
    const error = await outcome(withTimeout(base, 20)("https://example.test/hang"));
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).toMatch(/TimeoutError|AbortError/);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(10);
  });

  it("lets a caller-supplied signal abort the call before the timeout", async () => {
    const { base, calls } = hungFetch();
    const controller = new AbortController();
    const call = withTimeout(base, 60_000)("https://example.test/x", { signal: controller.signal });
    const signal = calls[0].init?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal).not.toBe(controller.signal);
    controller.abort(new Error("caller aborted"));
    const error = await outcome(call);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("caller aborted");
    expect(signal?.aborted).toBe(true);
  });

  it("works for a call without init", async () => {
    const response = { ok: true } as Response;
    const { base, calls } = recordingFetch(async () => response);
    await expect(withTimeout(base, 5_000)("https://example.test/x")).resolves.toBe(response);
    expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal);
    expect(calls[0].init?.signal?.aborted).toBe(false);
  });

  it("keeps a Request input's own signal, so aborting its controller after the call starts cancels it", async () => {
    const { base, calls } = hungFetch();
    const controller = new AbortController();
    const request = new Request("https://example.test/x", { signal: controller.signal });
    const call = withTimeout(base, 60_000)(request);
    const signal = calls[0].init?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal).not.toBe(controller.signal);
    expect(signal?.aborted).toBe(false);
    controller.abort(new Error("caller aborted"));
    expect((await outcome(call)) as Error).toMatchObject({ message: "caller aborted" });
    expect(signal?.aborted).toBe(true);
  });

  it("gives the base fetch an already-aborted signal for a Request that is already aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("already aborted"));
    const request = new Request("https://example.test/x", { signal: controller.signal });
    const { base, calls } = hungFetch();
    const call = withTimeout(base, 60_000)(request);
    expect(calls[0].init?.signal?.aborted).toBe(true);
    expect(await outcome(call)).toBeInstanceOf(Error);
  });

  it("lets an explicit init.signal override the Request's own signal", async () => {
    const aborted = new AbortController();
    aborted.abort(new Error("already aborted"));
    const request = new Request("https://example.test/x", { signal: aborted.signal });
    const live = new AbortController();
    const { base, calls } = hungFetch();
    const call = withTimeout(base, 60_000)(request, { signal: live.signal });
    expect(calls[0].init?.signal?.aborted).toBe(false);
    live.abort(new Error("live caller"));
    expect((await outcome(call)) as Error).toMatchObject({ message: "live caller" });
  });
});
