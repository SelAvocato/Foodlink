"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import type { GroupServed, UnusableReason } from "@/contracts/volunteer-distribution";
import { DistributionEntryView } from "./distribution-entry-view";
import { validateImage } from "@/contracts/image";
import {
  createDistributionEntryInputSchema,
  overLimitMessage,
  type UpdateDistributionEntryInput,
  updateDistributionEntryInputSchema,
} from "./schema";

type Mode = "create" | "edit";

type DistributionSummary = {
  id: string;
  referenceCode: string;
  status: string;
  totalQuantity: number;
  unit: string;
  distributedQuantity: number;
  unusableQuantity: number;
  remainingQuantity: number;
  entryCount: number;
  canAddEntry: boolean;
  canComplete: boolean;
};

type DistributionEntryView = {
  id: string;
  date: string;
  place: string;
  groupServed: string;
  peopleServed: number;
  portionsDistributed: number;
  portionsUnusable: number;
  unusableReason: string | null;
  notes: string | null;
};

type DistributionEntriesResponse = {
  summary: DistributionSummary;
  entries: DistributionEntryView[];
};

type FormState = {
  date: string;
  place: string;
  groupServed: GroupServed;
  peopleServed: string;
  portionsDistributed: string;
  portionsUnusable: string;
  unusableReason: UnusableReason | "";
  notes: string;
};

const EMPTY_FORM: FormState = {
  date: "",
  place: "",
  groupServed: "families",
  peopleServed: "",
  portionsDistributed: "",
  portionsUnusable: "",
  unusableReason: "",
  notes: "",
};

function emptyErrors(): Record<string, string> {
  return {};
}

function asNumber(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function submissionFromForm(form: FormState): Record<string, unknown> {
  return {
    date: form.date,
    place: form.place,
    groupServed: form.groupServed,
    peopleServed: asNumber(form.peopleServed),
    portionsDistributed: asNumber(form.portionsDistributed),
    portionsUnusable: asNumber(form.portionsUnusable),
    unusableReason: form.unusableReason || undefined,
    notes: form.notes || undefined,
  };
}

function pathToKey(path: readonly PropertyKey[]): string | null {
  if (path.length === 0) return null;
  return String(path[0]);
}

export function DistributionEntryScreen({
  donationId,
  entryId,
  mode,
}: {
  donationId: string;
  entryId?: string;
  mode: Mode;
}) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>(emptyErrors);
  const [banner, setBanner] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [summary, setSummary] = useState<DistributionEntriesResponse["summary"] | null>(null);
  const [selectedPhoto, setSelectedPhoto] = useState<{ file: File; preview: string } | null>(null);
  const [editingEntry, setEditingEntry] = useState<{
    peopleServed: number;
    portionsDistributed: number;
    portionsUnusable: number;
  } | null>(null);
  const loadRun = useRef(0);
  const submitRun = useRef(0);

  const basePath = `/api/donations/${encodeURIComponent(donationId)}/distribution-entries`;
  const requestPath =
    mode === "create" ? basePath : `${basePath}/${encodeURIComponent(entryId ?? "")}`;

  useEffect(() => {
    loadRun.current += 1;
    const mine = loadRun.current;

    void fetch(basePath, { cache: "no-store", signal: AbortSignal.timeout(10_000) })
      .then(async (response) => {
        if (loadRun.current !== mine) return;
        if (!response.ok) {
          if (response.status === 404) {
            void router.push("/volunteer");
          } else if (response.status === 401) {
            void router.push("/login");
          }
          return;
        }
        const body = (await response.json().catch(() => null)) as
          | DistributionEntriesResponse
          | null;
        if (body === null) return;
        setSummary(body.summary);

        if (mode === "edit" && entryId !== undefined) {
          const found = body.entries.find((entry) => entry.id === entryId);
          if (found === undefined) {
            void router.push("/volunteer");
            return;
          }
          setEditingEntry({
            peopleServed: found.peopleServed,
            portionsDistributed: found.portionsDistributed,
            portionsUnusable: found.portionsUnusable,
          });
          setForm({
            date: found.date,
            place: found.place,
            groupServed: found.groupServed as GroupServed,
            peopleServed: String(found.peopleServed),
            portionsDistributed: String(found.portionsDistributed),
            portionsUnusable: String(found.portionsUnusable),
            unusableReason: (found.unusableReason ?? "") as UnusableReason | "",
            notes: found.notes ?? "",
          });
        }
      })
      .catch(() => {
        if (loadRun.current !== mine) return;
        setBanner("Couldn't save changes. Your entries are preserved. Try again.");
      });
  }, [basePath, donationId, entryId, mode, router]);

  const setField = useCallback(
    (key: keyof FormState, value: string) => {
      setForm((current) => ({ ...current, [key]: value }) as FormState);
      if (errors[key] !== undefined) {
        setErrors((current) => {
          const next = { ...current };
          delete next[key];
          return next;
        });
      }
    },
    [errors],
  );

  const onDateChange = useCallback((value: string) => setField("date", value), [setField]);
  const onPlaceChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setField("place", event.target.value),
    [setField],
  );
  const onGroupChange = useCallback(
    (value: string) => setField("groupServed", value),
    [setField],
  );
  const onPeopleChange = useCallback(
    (value: string) => setField("peopleServed", value),
    [setField],
  );
  const onPortionsChange = useCallback(
    (value: string) => setField("portionsDistributed", value),
    [setField],
  );
  const onUnusableChange = useCallback(
    (value: string) => setField("portionsUnusable", value),
    [setField],
  );
  const onReasonChange = useCallback(
    (value: string) => setField("unusableReason", value),
    [setField],
  );
  const onNotesChange = useCallback(
    (value: string) => setField("notes", value),
    [setField],
  );
  const onPhotoChange = useCallback(
    (file: File | null) => {
      if (!file) {
        setSelectedPhoto(null);
        return;
      }
      // Read the file as ArrayBuffer first, then validate and create preview
      file.arrayBuffer().then((bytes) => {
        const check = validateImage(new Uint8Array(bytes));
        if (!check.ok) {
          setSelectedPhoto(null);
          return;
        }
        // Create preview
        const reader = new FileReader();
        reader.onload = (e) => {
          const preview = e.target?.result as string;
          setSelectedPhoto({ file, preview });
        };
        reader.readAsDataURL(file);
      });
    },
    [],
  );

  const validateAndSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setErrors(emptyErrors());
      setBanner(null);

      const schema =
        mode === "create"
          ? createDistributionEntryInputSchema
          : updateDistributionEntryInputSchema;
      const parsed = schema.safeParse(submissionFromForm(form));

      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          const key = pathToKey(issue.path);
          if (key === null) {
            setBanner(issue.message);
            continue;
          }
          setErrors((current) => ({ ...current, [key]: issue.message }));
        }
        return;
      }

      setIsSubmitting(true);
      const run = ++submitRun.current;

      const body =
        mode === "create" ? parsed.data : (parsed.data as UpdateDistributionEntryInput);
      try {
        const response = await fetch(requestPath, {
          method: mode === "create" ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          cache: "no-store",
          signal: AbortSignal.timeout(10_000),
        });

        if (run !== submitRun.current) return;

        if (response.status === 200 || response.status === 201) {
          void router.replace(`/tasks/${encodeURIComponent(donationId)}/distribution`);
          return;
        }

        if (response.status === 401) {
          void router.push("/login");
          return;
        }

        if (response.status === 404) {
          void router.push("/volunteer");
          return;
        }

        if (response.status === 409) {
          const bodyText = await response.json().catch(() => null);
          if (bodyText?.error === "PORTIONS_EXCEEDED" && summary !== null) {
            const distributed = asNumber(form.portionsDistributed) ?? 0;
            const unusable = asNumber(form.portionsUnusable) ?? 0;
            const existingDistributed = editingEntry?.portionsDistributed ?? 0;
            const existingUnusable = editingEntry?.portionsUnusable ?? 0;
            const wouldBeAccounted =
              summary.distributedQuantity +
              summary.unusableQuantity -
              (mode === "edit" ? existingDistributed + existingUnusable : 0) +
              distributed +
              unusable;
            setBanner(overLimitMessage(wouldBeAccounted, summary.totalQuantity));
          } else {
            setBanner(
              bodyText?.message ?? "Couldn't save changes. Your entries are preserved. Try again.",
            );
          }
          setIsSubmitting(false);
          return;
        }

        const bodyText = await response.json().catch(() => null);
        setBanner(
          bodyText?.message ?? "Couldn't save changes. Your entries are preserved. Try again.",
        );
        setIsSubmitting(false);
      } catch {
        if (run !== submitRun.current) return;
        setBanner("Couldn't save changes. Your entries are preserved. Try again.");
        setIsSubmitting(false);
      }
    },
    [
      requestPath,
form,
  mode,
  editingEntry,
  summary,
  router,
      donationId,
    ],
  );

  const onCancel = useCallback(() => {
    void router.replace(`/tasks/${encodeURIComponent(donationId)}/distribution`);
  }, [router, donationId]);

  const subtitle =
    summary === null
      ? ""
      : `${summary.referenceCode} · ${summary.remainingQuantity} portions remaining`;

  return (
    <DistributionEntryView
      title={mode === "create" ? "Add distribution entry" : "Edit distribution entry"}
      subtitle={subtitle}
      form={form}
      errors={errors}
      banner={banner}
      isSubmitting={isSubmitting}
      onSave={validateAndSubmit}
      onCancel={onCancel}
      onDateChange={onDateChange}
      onPlaceChange={onPlaceChange}
      onGroupChange={onGroupChange}
      onPeopleChange={onPeopleChange}
      onPortionsChange={onPortionsChange}
      onUnusableChange={onUnusableChange}
      onReasonChange={onReasonChange}
      onNotesChange={onNotesChange}
      onPhotoChange={onPhotoChange}
      selectedPhoto={selectedPhoto}
    />
  );
}
