import { cn } from "@/lib/utils";

export type RadioCardOption = {
  value: string;
  label: string;
  /** e.g. "Active · Availability: Weekday afternoons" — written status, never colour only. */
  description: string;
  disabled?: boolean;
};

/** Radio list for choices like the volunteer picker. Native radios = free keyboard + a11y. */
export function RadioCardGroup({
  name,
  legend,
  options,
  value,
  onChange,
}: {
  name: string;
  legend: string;
  options: RadioCardOption[];
  value: string | null;
  onChange: (value: string) => void;
}) {
  return (
    <fieldset className="space-y-3">
      <legend className="sr-only">{legend}</legend>
      {options.map((o) => {
        const checked = value === o.value;
        return (
          <label
            key={o.value}
            className={cn(
              "flex min-h-11 cursor-pointer items-start gap-3 rounded-xl p-4 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
              checked ? "bg-success" : "bg-background",
              o.disabled && "cursor-not-allowed opacity-60",
            )}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={checked}
              disabled={o.disabled}
              onChange={() => onChange(o.value)}
              className="mt-1 size-4 accent-primary"
            />
            <span>
              <span className={cn("block text-base font-semibold leading-6", checked ? "text-primary" : "text-foreground")}>
                {o.label}
              </span>
              <span className="block text-xs leading-[18px] text-muted-foreground">{o.description}</span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
