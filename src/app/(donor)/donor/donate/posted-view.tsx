"use client";

import { QRCodeCanvas } from "qrcode.react";
import { useCallback, useEffect, useRef, useState } from "react";
import { FeedbackBanner } from "@/components/shared/feedback-banner";
import { PostedLabel } from "./posted-label";
import {
  QR_LOAD_ERROR,
  imageFileName,
  labelCode,
  parseQrResponse,
  pickupText,
  portionsText,
  qrPayload,
} from "./posted-logic";

type PostedViewProps = {
  donationId: string;
  foodName: string;
  portions: number;
  pickupLines: string[];
};

type QrState =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; payload: string };

// A stalled answer ends as a failed read, so the retry banner can show.
const QR_TIMEOUT_MS = 10_000;

/** The token from the QR route, or null on any failure. It is never logged or shown. */
async function readQrToken(donationId: string): Promise<string | null> {
  try {
    // The signal also covers the body read below.
    const response = await fetch(`/api/donor/donations/${donationId}/qr`, {
      signal: AbortSignal.timeout(QR_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return parseQrResponse((await response.json()) as unknown, donationId);
  } catch {
    return null;
  }
}

const QR_SIZE = 240;

export function PostedView({ donationId, foodName, portions, pickupLines }: PostedViewProps) {
  const [qr, setQr] = useState<QrState>({ status: "loading" });
  // A late answer from an earlier read (or after leaving the page) is dropped.
  const loadRunRef = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const run = useCallback(() => {
    loadRunRef.current += 1;
    const mine = loadRunRef.current;
    void readQrToken(donationId).then((token) => {
      if (loadRunRef.current !== mine) return;
      setQr(
        token === null
          ? { status: "failed" }
          : { status: "ready", payload: qrPayload(window.location.origin, token) },
      );
    });
  }, [donationId]);

  useEffect(() => {
    run();
    const runs = loadRunRef;
    return () => {
      runs.current += 1;
    };
  }, [run]);

  function handleRetry() {
    setQr({ status: "loading" });
    run();
  }

  function handleSaveImage() {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    canvas.toBlob((blob) => {
      if (blob === null) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = imageFileName(donationId);
      link.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  }

  const ready = qr.status === "ready";
  const qrSlot =
    qr.status === "ready" ? (
      <QRCodeCanvas
        ref={canvasRef}
        value={qr.payload}
        size={QR_SIZE}
        level="M"
        marginSize={4}
        aria-label="Donation QR code"
      />
    ) : (
      <div className="flex size-60 items-center justify-center rounded-sm border border-dashed border-(--fl-muted)/40 text-sm text-(--fl-muted)">
        {qr.status === "loading" ? "Loading QR code…" : "QR code unavailable"}
      </div>
    );

  return (
    <div className="flex flex-col gap-6">
      {qr.status === "failed" ? (
        <FeedbackBanner
          tone="error"
          title="Could not load your QR label"
          action={{ label: "Try again", onClick: handleRetry }}
        >
          {QR_LOAD_ERROR}
        </FeedbackBanner>
      ) : null}
      <PostedLabel
        foodName={foodName}
        shortCode={labelCode(donationId)}
        portionsText={portionsText(portions)}
        pickupText={pickupText(pickupLines)}
        qrSlot={qrSlot}
        onPrint={ready ? () => window.print() : undefined}
        onSaveImage={handleSaveImage}
        saveDisabled={!ready}
      />
    </div>
  );
}
