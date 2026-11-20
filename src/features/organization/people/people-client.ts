import {
  adminPeopleListResponseSchema,
  type AdminPeopleListQuery,
  type AdminPeopleListResponse,
} from "@/contracts/admin-people";
import { mapReviewError } from "./people-logic";

export type PeopleQuery = AdminPeopleListQuery;
export type MutationResult =
  | { ok: true; resultingStatus: "ACTIVE" | "SUSPENDED" }
  | { ok: false; error: string };

async function errorCode(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "error" in body && typeof body.error === "string") {
      return body.error;
    }
  } catch {}
  return undefined;
}

export async function listPeople(query: PeopleQuery, signal?: AbortSignal): Promise<AdminPeopleListResponse> {
  const params = new URLSearchParams({
    role: query.role,
    status: query.status,
    type: query.type,
    q: query.q,
    page: String(query.page),
    pageSize: String(query.pageSize),
  });
  const response = await fetch(`/api/admin/people?${params.toString()}`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error("People request failed");
  return adminPeopleListResponseSchema.parse(await response.json());
}

async function review(
  userId: string,
  body: { action: "SUSPEND"; reason: string } | { action: "REACTIVATE" },
): Promise<MutationResult> {
  const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    return { ok: false, error: mapReviewError(response.status, await errorCode(response)) };
  }
  return {
    ok: true,
    resultingStatus: body.action === "SUSPEND" ? "SUSPENDED" : "ACTIVE",
  };
}

export function suspendAccount(userId: string, reason: string): Promise<MutationResult> {
  return review(userId, { action: "SUSPEND", reason: reason.trim() });
}

export function reactivateAccount(userId: string): Promise<MutationResult> {
  return review(userId, { action: "REACTIVATE" });
}
