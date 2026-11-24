"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ALLOWED_IMAGE_TYPES } from "@/contracts/image";

const PREVIEWABLE_TYPES = new Set<string>(ALLOWED_IMAGE_TYPES);

type Preview = { url: string; name: string; size: number };

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

/**
 * Shows the chosen proof image in this browser only. Nothing is uploaded here:
 * the form still sends the file on submit. It listens to the file input by id.
 */
export function ProofPreview({ inputId }: { inputId: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const urlRef = useRef<string | null>(null);

  const drop = useCallback(() => {
    if (urlRef.current !== null) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  // Release the object URL when the form goes away.
  useEffect(() => drop, [drop]);

  useEffect(() => {
    const input = document.getElementById(inputId);
    if (!(input instanceof HTMLInputElement)) return;
    const onChange = () => {
      drop();
      const file = input.files?.[0];
      if (file === undefined || !PREVIEWABLE_TYPES.has(file.type)) {
        setPreview(null);
        return;
      }
      const url = URL.createObjectURL(file);
      urlRef.current = url;
      setPreview({ url, name: file.name, size: file.size });
    };
    input.addEventListener("change", onChange);
    return () => input.removeEventListener("change", onChange);
  }, [inputId, drop]);

  function remove() {
    const input = document.getElementById(inputId);
    if (input instanceof HTMLInputElement) input.value = "";
    drop();
    setPreview(null);
  }

  if (preview === null) return null;

  return (
    <div className="mt-4 flex items-center gap-4">
      <div
        role="img"
        aria-label={"Preview of " + preview.name}
        className="h-24 w-32 shrink-0 rounded-sm border border-(--fl-muted)/40 bg-(--fl-canvas) bg-contain bg-center bg-no-repeat"
        style={{ backgroundImage: 'url("' + preview.url + '")' }}
      />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-(--fl-primary)">{preview.name}</p>
        <p className="text-xs text-(--fl-muted)">{formatFileSize(preview.size)}</p>
        <button
          type="button"
          onClick={remove}
          className="mt-2 text-sm text-(--fl-primary) hover:underline"
        >
          Remove
        </button>
      </div>
    </div>
  );
}
