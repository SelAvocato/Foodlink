"use client";

import { useRef, type ChangeEvent } from "react";
import { Button } from "@/components/ui/button";

const FULL_BUTTON = "h-[52px] w-full rounded-sm text-base font-semibold";

/**
 * Figma p47: the phone body for step 2. The view owns the upload; this screen
 * only stages a preview and asks for it to be screened.
 */
export function PhotoStepMobile({
  code,
  portionsLabel,
  foodName,
  previewUrl,
  canScreen,
  locked,
  onFileChange,
  onScreen,
}: {
  code: string;
  portionsLabel: string;
  foodName: string;
  previewUrl: string | null;
  canScreen: boolean;
  locked: boolean;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onScreen: () => void;
}) {
  const takeInput = useRef<HTMLInputElement | null>(null);
  const chooseInput = useRef<HTMLInputElement | null>(null);

  return (
    // The view pads itself px-6 py-8; cancel that so the page padding comes only
    // from the layout, as on p44 and p45.
    <div className="-mx-6 -my-8">
      <div className="mx-auto w-full max-w-md">
        <h1 className="text-display font-semibold text-foreground">Photograph the food</h1>
        <p className="mt-2 text-body text-muted-foreground">
          Step 2 of 3 · Independent food check
        </p>

        <div className="mt-7 rounded-md bg-success px-4 py-5 text-body text-primary">
          <p>QR verified · {code}</p>
          <p>
            {portionsLabel} · {foodName}
          </p>
        </div>

        <div
          role={previewUrl === null ? undefined : "img"}
          aria-label={previewUrl === null ? undefined : "Your pickup photo preview"}
          style={previewUrl === null ? undefined : { backgroundImage: "url(" + previewUrl + ")" }}
          className="mt-7 flex min-h-[250px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card bg-cover bg-center px-6 py-8 text-center"
        >
          {previewUrl === null ? (
            <>
              <p className="text-heading font-semibold text-primary">Show the food and packaging</p>
              <p className="mt-2 text-body text-muted-foreground">Take your own photo at pickup.</p>
              <p className="text-body text-muted-foreground">JPEG, PNG, WebP · Up to 4 MB</p>
            </>
          ) : null}
        </div>

        <input
          ref={takeInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          aria-label="Take pickup photo"
          onChange={onFileChange}
          disabled={locked}
          className="sr-only"
        />
        <input
          ref={chooseInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          aria-label="Choose pickup photo"
          onChange={onFileChange}
          disabled={locked}
          className="sr-only"
        />

        <Button
          className={FULL_BUTTON + " mt-8"}
          disabled={locked}
          onClick={() => takeInput.current?.click()}
        >
          Take photo
        </Button>
        <Button
          variant="outline"
          className={FULL_BUTTON + " mt-4"}
          disabled={locked}
          onClick={() => chooseInput.current?.click()}
        >
          Choose image
        </Button>
        <Button
          className={
            FULL_BUTTON +
            " mt-9 disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100"
          }
          disabled={!canScreen}
          onClick={onScreen}
        >
          Screen pickup photo
        </Button>

        <p className="mt-8 text-body text-muted-foreground">
          Retake before submitting if the image is unclear.
        </p>
      </div>
    </div>
  );
}
