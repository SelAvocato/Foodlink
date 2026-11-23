/** How long one scan request may take before the page offers Try again. */
export const SCAN_TIMEOUT_MS = 10_000;

/** What the scan page is showing: the label is spent the moment we read it. */
export type ScanState =
  | { kind: "idle" }
  | { kind: "scanning" }
  | { kind: "goInspection"; donationId: string }
  | { kind: "alreadyRecorded" }
  | { kind: "cannotVerify" }
  | { kind: "sessionExpired" }
  | { kind: "wrongRole" }
  | { kind: "networkError" };

/**
 * The token from a location.hash, or null when the fragment holds none. The QR
 * label opens /volunteer/scan#<token>, so the fragment is the only input.
 */
export function tokenFromHash(hash: string): string | null {
  const token = hash.replace(/^#/, "").trim();
  return token === "" ? null : token;
}

/**
 * The token inside the text a camera decoded, or null when the text is not a URL
 * with a non-empty fragment. The label encodes <origin>/volunteer/scan#<token>.
 * The origin is not checked: a label printed on one deployment must still scan
 * on another, and the server validates the token anyway.
 */
export function tokenFromScannedText(text: string): string | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  return tokenFromHash(url.hash);
}

/** The inspection screen for a donation. The id is encoded; no token is added. */
export function inspectionPath(donationId: string): string {
  return "/volunteer/donations/" + encodeURIComponent(donationId) + "/inspection";
}

type ScanAnswer = { nextStep: string | null; donationId: string | null };

/** Reads the two fields the page uses without trusting the rest of the body. */
function scanAnswer(body: unknown): ScanAnswer {
  if (typeof body !== "object" || body === null) {
    return { nextStep: null, donationId: null };
  }
  const record = body as Record<string, unknown>;
  return {
    nextStep: typeof record.nextStep === "string" ? record.nextStep : null,
    donationId:
      typeof record.donationId === "string" && record.donationId !== "" ? record.donationId : null,
  };
}

/**
 * The scan answer as a view state. 404 and 409 are final; a server fault and any
 * other status are treated like an unreachable server so Try again is offered.
 */
export function stateFromResponse(status: number, body: unknown): ScanState {
  if (status === 200) {
    const answer = scanAnswer(body);
    if (answer.nextStep === "DROPOFF") return { kind: "alreadyRecorded" };
    if (answer.nextStep === "INSPECTION" && answer.donationId !== null) {
      return { kind: "goInspection", donationId: answer.donationId };
    }
    // A 200 we cannot read must not leave the page spinning.
    return { kind: "networkError" };
  }
  if (status === 404 || status === 409) return { kind: "cannotVerify" };
  if (status === 401) return { kind: "sessionExpired" };
  if (status === 403) return { kind: "wrongRole" };
  return { kind: "networkError" };
}

/** The status block's text; null means the page shows no block at all. */
export type ScanCopy = {
  tone: "info" | "error";
  title: string | null;
  body: string | null;
};

export function scanCopy(state: ScanState): ScanCopy | null {
  switch (state.kind) {
    case "scanning":
      return { tone: "info", title: null, body: "Checking the QR code..." };
    case "alreadyRecorded":
      return {
        tone: "info",
        title: "Pickup already recorded",
        body: "This donation was already picked up. Repeated scans do not create another pickup.",
      };
    case "cannotVerify":
      return {
        tone: "error",
        title: "QR cannot be verified",
        body: "Wrong volunteer, invalid token, wrong stage, or expired pickup window. Scan the correct label or contact staff.",
      };
    case "sessionExpired":
      return {
        tone: "error",
        title: null,
        body: "Your session has expired. Log in again, then scan the label again.",
      };
    case "wrongRole":
      return { tone: "error", title: null, body: "This page is for volunteers." };
    case "networkError":
      return { tone: "error", title: null, body: "Could not reach the server." };
    case "idle":
    case "goInspection":
      // Idle is the plain Figma layout; goInspection leaves the page at once.
      return null;
  }
}

/** Only an unreachable server (or a 500) is worth another try; 404 and 409 are final. */
export function isRetryable(state: ScanState): boolean {
  return state.kind === "networkError";
}
