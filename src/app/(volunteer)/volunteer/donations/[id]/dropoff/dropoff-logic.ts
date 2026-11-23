import { DonationStatus, QrScanStage } from "@/contracts/enums";
import { validateImage } from "@/contracts/image";

export const HANDOVER_PHOTO_MESSAGE = "Photo must be a JPEG, PNG, or WebP image up to 4 MB.";
export const MAX_HANDOVER_PHOTO_BYTES = 4 * 1024 * 1024;

export function dropoffPath(donationId: string): string {
  return `/api/volunteer/donations/${encodeURIComponent(donationId)}/dropoff`;
}

export function handoverPhotoPath(donationId: string): string {
  return `/api/volunteer/donations/${encodeURIComponent(donationId)}/photos/handover`;
}

export function distributionPath(donationId: string): string {
  return `/volunteer/donations/${encodeURIComponent(donationId)}/distribution`;
}

export function volunteerTaskPagePath(donationId: string): string {
  return `/volunteer/donations/${encodeURIComponent(donationId)}`;
}

export function dropoffPagePath(donationId: string): string {
  return `/volunteer/donations/${encodeURIComponent(donationId)}/dropoff`;
}

export function referenceCode(shortCode: string): string {
  return `#${shortCode}`;
}

export function subtitle(shortCode: string): string {
  return `${referenceCode(shortCode)} · Picked up`;
}

export type DropoffScanResponse = {
  stage: typeof QrScanStage.DROPOFF;
  status: typeof DonationStatus.DELIVERED;
  scannedAt: Date;
  alreadyScanned: boolean;
};

export type HandoverPhotoResponse = {
  uploaded: true;
};

export async function checkPhotoFile(
  file: File,
): Promise<
  | { ok: true; file: File; previewUrl: string }
  | { ok: false; message: string }
> {
  const bytes = new Uint8Array(await file.arrayBuffer());

  if (bytes.length > MAX_HANDOVER_PHOTO_BYTES) {
    return { ok: false, message: HANDOVER_PHOTO_MESSAGE };
  }

  const check = validateImage(bytes);
  if (!check.ok) {
    return { ok: false, message: HANDOVER_PHOTO_MESSAGE };
  }

  return { ok: true, file, previewUrl: URL.createObjectURL(file) };
}

export function revokePreview(previewUrl: string | null): void {
  if (previewUrl !== null) {
    URL.revokeObjectURL(previewUrl);
  }
}
