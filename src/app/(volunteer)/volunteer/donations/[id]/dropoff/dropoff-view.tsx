"use client";

import { type ChangeEvent, type RefObject } from "react";
import { FeedbackBanner } from "@/components/shared/feedback-banner";
import { CameraScanner } from "../../../scan/camera-scanner";

type ScanState = "idle" | "scanning" | "verified" | "failed";
type PhotoStatus = "idle" | "uploading" | "uploaded" | "failed";

const PRIMARY = "bg-[#176448] text-white enabled:hover:bg-[#12513a]";
const OUTLINE =
  "border border-[#DCE4DE] bg-white text-[#176448] enabled:hover:bg-[#EAF4EE]";
const BUTTON_BASE =
  "inline-flex min-h-11 h-[52px] w-full items-center justify-center rounded-sm text-base font-semibold disabled:cursor-not-allowed disabled:opacity-50";

type DropoffViewProps = {
  title: string;
  subtitle: string;
  cameraOn: boolean;
  toggleCamera: () => void;
  scanState: ScanState;
  scanError: string | null;
  cameraMessage: string | null;
  onScanDecoded: (text: string) => void;
  onCameraError: (kind: "denied" | "unavailable") => void;
  retryScan: () => void;
  photoFile: File | null;
  previewUrl: string | null;
  photoStatus: PhotoStatus;
  uploadError: string | null;
  onAddPhoto: () => void;
  onPhotoSelect: (event: ChangeEvent<HTMLInputElement>) => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
  retryUpload: () => void;
  retakePhoto: () => void;
  confirmDelivery: () => void;
  confirmDisabled: boolean;
  confirmError: string | null;
};

export function DropoffView({
  title,
  subtitle,
  cameraOn,
  toggleCamera,
  scanState,
  scanError,
  cameraMessage,
  onScanDecoded,
  onCameraError,
  retryScan,
  photoFile,
  previewUrl,
  photoStatus,
  uploadError,
  onAddPhoto,
  onPhotoSelect,
  retryUpload,
  retakePhoto,
  confirmDelivery,
  confirmDisabled,
  confirmError,
  fileInputRef,
}: DropoffViewProps) {
  return (
    <div className="mx-auto w-full max-w-[390px] px-5 py-6">
      <h1 className="text-display font-semibold text-foreground">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>

      <FeedbackBanner
        tone="neutral"
        title="At the organization's distribution point, scan the same donation QR again."
      />

      {cameraOn ? (
        <div className="relative mt-6 h-[353px] w-full rounded-2xl bg-[#1D3029]">
          <CameraScanner onDecoded={onScanDecoded} onCameraError={onCameraError} />
          <button
            type="button"
            onClick={toggleCamera}
            className="absolute left-1/2 bottom-6 -translate-x-1/2 flex items-center gap-1.5 rounded-sm border border-[#DCE4DE] bg-white px-3 text-[#176448] text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#176448]"
          >
            Stop camera
          </button>
        </div>
      ) : null}

      <button
        type="button"
        onClick={toggleCamera}
        disabled={scanState === "scanning" || photoStatus === "uploading"}
        className={`${BUTTON_BASE} mt-6 w-full ${PRIMARY}`}
      >
        {cameraOn ? "Stop camera" : "Enable camera"}
      </button>

      {cameraMessage !== null ? (
        <FeedbackBanner tone="error" title={cameraMessage} />
      ) : null}

      {scanState === "scanning" ? (
        <FeedbackBanner tone="neutral" title="Checking the QR code..." />
      ) : null}

      {scanState === "verified" ? (
        <FeedbackBanner tone="success" title="Drop-off QR verified" />
      ) : null}

      {scanError !== null ? (
        <FeedbackBanner
          tone="error"
          title={scanError}
          action={{ label: "Try again", onClick: retryScan }}
        />
      ) : null}

      <h2 className="mt-8 text-heading font-semibold text-foreground">
        Required handover photo
      </h2>

      <div className="mt-4 rounded-xl border border-dashed border-[#DCE4DE] p-5">
        <h3 className="text-heading font-semibold text-[#176448]">
          Capture the handover
        </h3>
        <p className="mt-2 text-sm text-[#63746D]">
          Avoid identifiable faces, especially minors. JPEG, PNG, WebP · Up to 4 MB
        </p>
      </div>

      <button
        type="button"
        onClick={onAddPhoto}
        disabled={photoStatus === "uploading" || scanState === "scanning"}
        className={`${BUTTON_BASE} mt-4 w-full ${OUTLINE}`}
      >
        {photoStatus === "uploading" ? "Uploading…" : "Add handover photo"}
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={onPhotoSelect}
      />

      {photoFile !== null && previewUrl !== null ? (
        <div className="mt-4">
          <img
            src={previewUrl}
            alt="Handover photo"
            className="max-h-48 w-full rounded-lg object-cover border border-[#DCE4DE]"
          />
          <button
            type="button"
            onClick={retakePhoto}
            className={`${BUTTON_BASE} mt-3 w-auto ${OUTLINE}`}
          >
            Retake
          </button>
        </div>
      ) : null}

      {uploadError !== null ? (
        <FeedbackBanner
          tone="error"
          title="Couldn't save changes. Your entries are preserved. Try again."
          action={{ label: "Try again", onClick: retryUpload }}
        />
      ) : null}

      <button
        type="button"
        onClick={confirmDelivery}
        disabled={confirmDisabled}
        className={`${BUTTON_BASE} mt-6 w-full ${PRIMARY}`}
      >
        Confirm delivery
      </button>

      {confirmError !== null ? (
        <p className="mt-2 text-sm text-[#B3261E]">{confirmError}</p>
      ) : null}

      <p className="mt-4 text-sm text-[#63746D]">
        A valid drop-off scan and photo are required. Delivery does not complete the donation.
      </p>
    </div>
  );
}
