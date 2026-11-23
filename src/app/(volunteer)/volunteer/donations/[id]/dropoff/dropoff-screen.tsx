"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { tokenFromScannedText } from "../../../scan/scan-logic";
import { DropoffView } from "./dropoff-view";
import type { TaskDetail } from "../inspection/pickup-inspection-logic";
import {
  distributionPath,
  dropoffPath,
  handoverPhotoPath,
  checkPhotoFile,
  revokePreview,
  subtitle,
} from "./dropoff-logic";
type ScanState = "idle" | "scanning" | "verified" | "failed";
type PhotoStatus = "idle" | "uploading" | "uploaded" | "failed";

const SCAN_TIMEOUT_MS = 10_000;
const UPLOAD_TIMEOUT_MS = 30_000;

const cameraGuidance = (kind: "denied" | "unavailable"): string =>
  kind === "denied"
    ? "Camera permission was denied. Allow camera access in your browser settings, or open the QR label with your phone's camera app."
    : "This browser cannot open the camera here. Open the QR label with your phone's camera app.";

export function DropoffScreen({ task }: { task: TaskDetail }) {
  const router = useRouter();

  const [cameraOn, setCameraOn] = useState(false);
  const [scanState, setScanState] = useState<ScanState>("idle");
  const [scanError, setScanError] = useState<string | null>(null);
  const [cameraMessage, setCameraMessage] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [photoStatus, setPhotoStatus] = useState<PhotoStatus>("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const tokenRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const runRef = useRef(0);

  const scanVerified = scanState === "verified";
  const confirmDisabled = !(scanVerified && photoStatus === "uploaded");

  const submitToken = useCallback(
    async (token: string) => {
      tokenRef.current = token;
      const run = ++runRef.current;

      setScanState("scanning");
      setScanError(null);

      try {
        const response = await fetch(dropoffPath(task.donationId), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
          cache: "no-store",
          signal: AbortSignal.timeout(SCAN_TIMEOUT_MS),
        });

        if (run !== runRef.current) return;

        await response.json().catch(() => null);

        if (response.status === 200) {
          setScanState("verified");
          setScanError(null);
          return;
        }

        if (response.status === 404 || response.status === 409) {
          setScanState("failed");
          setScanError("QR cannot be verified");
          return;
        }

        if (response.status === 401) {
          setScanState("failed");
          setScanError("Session expired. Sign in again and scan the label.");
          return;
        }

        if (response.status === 403) {
          setScanState("failed");
          setScanError("This page is for volunteers.");
          return;
        }

        setScanState("failed");
        setScanError("Could not reach the server.");
      } catch {
        if (run !== runRef.current) return;
        setScanState("failed");
        setScanError("Could not reach the server.");
      }
    },
    [task.donationId],
  );

  const handleCameraDecoded = useCallback(
    (text: string) => {
      const token = tokenFromScannedText(text);
      if (token === null) {
        setScanState("failed");
        setScanError("QR cannot be verified");
        return;
      }
      void submitToken(token);
    },
    [submitToken],
  );

  const retryScan = useCallback(() => {
    const token = tokenRef.current;
    if (token !== null) void submitToken(token);
  }, [submitToken]);

  const toggleCamera = useCallback(() => {
    setCameraOn((previous) => {
      if (!previous) {
        setScanState("idle");
        setScanError(null);
        setCameraMessage(null);
      }
      return !previous;
    });
  }, []);

  const onCameraError = useCallback(
    (kind: "denied" | "unavailable") => {
      setCameraMessage(cameraGuidance(kind));
    },
    [],
  );

  const uploadPhoto = useCallback(
    async (file: File) => {
      setPhotoStatus("uploading");
      setUploadError(null);

      const form = new FormData();
      form.append("photo", file);

      try {
        const response = await fetch(handoverPhotoPath(task.donationId), {
          method: "POST",
          body: form,
          cache: "no-store",
          signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
        });

        const body = await response.json().catch(() => null);

        if (!response.ok || !body || body.uploaded !== true) {
          setPhotoStatus("failed");
          setUploadError(
            "Couldn't save changes. Your entries are preserved. Try again.",
          );
          return;
        }

        setPhotoStatus("uploaded");
        setUploadError(null);
      } catch {
        setPhotoStatus("failed");
        setUploadError("Couldn't save changes. Your entries are preserved. Try again.");
      }
    },
    [task.donationId],
  );

  const onPhotoSelect = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      const checked = await checkPhotoFile(file);
      if (!checked.ok) {
        setPhotoStatus("failed");
        setUploadError(checked.message);
        return;
      }

      setPhotoFile(file);
      setPreviewUrl(checked.previewUrl);
      void uploadPhoto(file);
    },
    [uploadPhoto],
  );

  const retryUpload = useCallback(() => {
    if (photoFile !== null) {
      void uploadPhoto(photoFile);
    }
  }, [photoFile, uploadPhoto]);

  const retakePhoto = useCallback(() => {
    if (fileInputRef.current !== null) {
      fileInputRef.current.value = "";
    }
    revokePreview(previewUrl);
    setPhotoFile(null);
    setPreviewUrl(null);
    setPhotoStatus("idle");
    setUploadError(null);
  }, [previewUrl]);

  const confirmDelivery = useCallback(() => {
    if (!scanVerified) {
      setConfirmError("Scan the drop-off QR before confirming delivery.");
      return;
    }

    if (photoStatus !== "uploaded") {
      setConfirmError("Add the handover photo before confirming delivery.");
      return;
    }

    setConfirmError(null);
    void router.replace(distributionPath(task.donationId));
  }, [scanVerified, photoStatus, router, task.donationId]);

  useEffect(() => {
    return () => {
      revokePreview(previewUrl);
    };
  }, [previewUrl]);

  return (
    <DropoffView
      title="Drop-off & proof"
      subtitle={subtitle(task.shortCode)}
      cameraOn={cameraOn}
      toggleCamera={toggleCamera}
      scanState={scanState}
      scanError={scanError}
      cameraMessage={cameraMessage}
      onScanDecoded={handleCameraDecoded}
      onCameraError={onCameraError}
      retryScan={retryScan}
      photoFile={photoFile}
      previewUrl={previewUrl}
      photoStatus={photoStatus}
      uploadError={uploadError}
      onAddPhoto={() => {
        fileInputRef.current?.click();
      }}
      onPhotoSelect={onPhotoSelect}
      retryUpload={retryUpload}
      retakePhoto={retakePhoto}
      confirmDelivery={confirmDelivery}
      confirmDisabled={confirmDisabled}
      confirmError={confirmError}
      fileInputRef={fileInputRef}
    />
  );
}
