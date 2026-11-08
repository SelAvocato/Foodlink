import { DEFAULT_SIGNED_URL_SECONDS } from "@/lib/storage";

export interface ProofStore {
  findDocument(userId: string, documentId: string): Promise<{ storageKey: string } | null>;
  insertAudit(row: {
    actorUserId: string;
    action: string;
    targetType: "user_document";
    targetId: string;
    details: Record<string, unknown>;
  }): Promise<void>;
}

export type ProofSignedUrlResult =
  | { ok: true; url: string; expiresInSeconds: number }
  | { ok: false; error: "NOT_FOUND" };

/**
 * A short-lived link to one proof document, called only after the handler's Admin check.
 * The audit row records who viewed which document, never the storage key or the URL.
 */
export async function getProofSignedUrl(
  deps: {
    store: ProofStore;
    storage: { getSignedUrl(key: string, expiresInSeconds: number): Promise<string> };
  },
  input: { adminId: string; userId: string; documentId: string },
): Promise<ProofSignedUrlResult> {
  const document = await deps.store.findDocument(input.userId, input.documentId);
  if (!document) return { ok: false, error: "NOT_FOUND" };

  const url = await deps.storage.getSignedUrl(document.storageKey, DEFAULT_SIGNED_URL_SECONDS);

  await deps.store.insertAudit({
    actorUserId: input.adminId,
    action: "proof_document_viewed",
    targetType: "user_document",
    targetId: input.documentId,
    details: { user_id: input.userId },
  });

  return { ok: true, url, expiresInSeconds: DEFAULT_SIGNED_URL_SECONDS };
}
