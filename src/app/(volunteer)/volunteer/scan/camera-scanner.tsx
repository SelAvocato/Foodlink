"use client";

import { useEffect, useRef } from "react";
import jsQR from "jsqr";

/** The label is dark on light, so the inverted pass only costs frames. */
const QR_OPTIONS = { inversionAttempts: "dontInvert" } as const;
/** One decode every 200 ms is plenty for a label held in front of the lens. */
const MIN_DECODE_GAP_MS = 200;
/** Decoding a full phone frame is wasteful; 480 px still reads a label. */
const MAX_FRAME_WIDTH = 480;

export type CameraErrorKind = "denied" | "unavailable";

type CameraScannerProps = {
  onDecoded: (text: string) => void;
  onCameraError: (kind: CameraErrorKind) => void;
};

/** Only a refused permission is "denied"; everything else is the environment. */
function cameraErrorKind(error: unknown): CameraErrorKind {
  if (typeof error === "object" && error !== null && "name" in error) {
    return error.name === "NotAllowedError" ? "denied" : "unavailable";
  }
  return "unavailable";
}

export function CameraScanner({ onDecoded, onCameraError }: CameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const element = videoRef.current;
    if (element === null) return undefined;
    // Annotated so the callbacks below keep the element type after the null check.
    const video: HTMLVideoElement = element;

    let cancelled = false;
    let lastText: string | null = null;
    let frameId: number | null = null;
    let lastDecodeAt = 0;
    let stream: MediaStream | null = null;

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });

    function stopStream() {
      if (stream !== null) {
        for (const track of stream.getTracks()) track.stop();
        stream = null;
      }
      video.srcObject = null;
    }

    function fail(error: unknown) {
      // A late rejection after unmount must not reach the page.
      if (cancelled) return;
      stopStream();
      onCameraError(cameraErrorKind(error));
    }

    function decodeFrame() {
      if (cancelled || context === null) return;
      const now = performance.now();
      if (now - lastDecodeAt < MIN_DECODE_GAP_MS) {
        frameId = requestAnimationFrame(decodeFrame);
        return;
      }
      lastDecodeAt = now;

      if (video.videoWidth === 0 || video.videoHeight === 0) {
        frameId = requestAnimationFrame(decodeFrame);
        return;
      }

      const scale = Math.min(1, MAX_FRAME_WIDTH / video.videoWidth);
      const width = Math.max(1, Math.round(video.videoWidth * scale));
      const height = Math.max(1, Math.round(video.videoHeight * scale));
      canvas.width = width;
      canvas.height = height;
      context.drawImage(video, 0, 0, width, height);

      const image = context.getImageData(0, 0, width, height);
      const result = jsQR(image.data, width, height, QR_OPTIONS);
      if (result === null) {
        frameId = requestAnimationFrame(decodeFrame);
        return;
      }

      // The same QR in front of the lens is reported once. A different text is
      // reported and scanning goes on; the page turns the camera off on a label.
      if (result.data !== lastText) {
        lastText = result.data;
        onDecoded(result.data);
      }
      frameId = requestAnimationFrame(decodeFrame);
    }

    const mediaDevices = navigator.mediaDevices;
    if (typeof mediaDevices?.getUserMedia !== "function" || context === null) {
      // Keep the state write out of the effect body.
      void Promise.resolve().then(() => {
        if (!cancelled) onCameraError("unavailable");
      });
      return () => {
        cancelled = true;
      };
    }

    mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
      .then((next) => {
        if (cancelled) {
          for (const track of next.getTracks()) track.stop();
          return;
        }
        stream = next;
        video.srcObject = next;
        return video.play().then(() => {
          if (cancelled) return;
          frameId = requestAnimationFrame(decodeFrame);
        });
      })
      .catch((error: unknown) => {
        fail(error);
      });

    return () => {
      cancelled = true;
      if (frameId !== null) cancelAnimationFrame(frameId);
      stopStream();
    };
  }, [onCameraError, onDecoded]);

  return (
    <video
      ref={videoRef}
      playsInline
      muted
      autoPlay
      className="absolute inset-0 size-full rounded-2xl object-cover"
    />
  );
}
