import type {
  AdminPeopleListQuery,
  AdminPeopleRole,
  AdminPeopleStatus,
  AdminPeopleType,
} from "@/contracts/admin-people";

export const DEFAULT_PAGE_SIZE = 20;
export const DEBOUNCE_MS = 300;
export const REQUEST_TIMEOUT_MS = 10000;

export interface PeopleViewState {
  role: AdminPeopleRole;
  status: AdminPeopleStatus | "ALL";
  type: AdminPeopleType;
  q: string;
  page: number;
  pageSize: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function buildPeopleQuery(state: PeopleViewState): AdminPeopleListQuery {
  const role = state.role === "VOLUNTEER" ? "VOLUNTEER" : "DONOR";
  const type = role === "VOLUNTEER" ? "ALL" : state.type;
  const page = Number.isFinite(state.page) ? clamp(Math.trunc(state.page), 1, 10000) : 1;
  const pageSizeRaw = Number.isFinite(state.pageSize) ? Math.trunc(state.pageSize) : DEFAULT_PAGE_SIZE;
  return {
    role,
    status: state.status === "ACTIVE" || state.status === "SUSPENDED" ? state.status : "ALL",
    type,
    q: state.q.trim().slice(0, 100),
    page,
    pageSize: clamp(pageSizeRaw, 1, 50),
  };
}

export function validateSuspendReason(reason: string): string | undefined {
  const trimmed = reason.trim();
  if (trimmed.length === 0) return "Enter a reason to suspend this account.";
  if (trimmed.length > 500) return "Use at most 500 characters.";
  return undefined;
}

export function mapReviewError(status: number, code?: string): string {
  if (status === 401 || status === 403) return "Your session changed. Sign in again and retry.";
  if (status === 400 || code === "INVALID_REQUEST") return "Enter a reason before suspending an account.";
  if (status === 409 || code === "INVALID_TRANSITION") {
    return "That account already changed. Refresh the list and try again.";
  }
  if (code === "NOT_FOUND") return "That account no longer exists. Refresh the list.";
  return "Couldn’t save changes. Try again.";
}

export function pageCount(total: number, pageSize: number): number {
  if (total <= 0 || pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}

export function rangeSummary(total: number, page: number, pageSize: number): string {
  if (total === 0) return "No results";
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  return `Showing ${start}–${end} of ${total}`;
}

export function statusLabel(status: AdminPeopleStatus): string {
  return status === "ACTIVE" ? "Active" : "Suspended";
}

export function donorTypeLabel(type: "ESTABLISHMENT" | "INDIVIDUAL" | null): string {
  if (type === "ESTABLISHMENT") return "Establishment";
  if (type === "INDIVIDUAL") return "Individual";
  return "Volunteer";
}

export function roleLabel(role: AdminPeopleRole): string {
  return role === "DONOR" ? "Donor" : "Volunteer";
}
