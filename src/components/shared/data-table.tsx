import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Hand-written table primitives. Wide tables scroll inside their own container. */
export function Table({ className, ...props }: ComponentProps<"table">) {
  return (
    <div className="w-full overflow-x-auto rounded-xl bg-card px-6 py-2">
      <table className={cn("w-full min-w-[640px] border-collapse text-sm leading-5", className)} {...props} />
    </div>
  );
}
export function TableHeader(props: ComponentProps<"thead">) {
  return <thead {...props} />;
}
export function TableBody(props: ComponentProps<"tbody">) {
  return <tbody {...props} />;
}
export function TableRow({ className, ...props }: ComponentProps<"tr">) {
  return <tr className={cn("border-b border-border last:border-b-0", className)} {...props} />;
}
export function TableHead({ className, ...props }: ComponentProps<"th">) {
  return (
    <th
      scope="col"
      className={cn("py-4 pr-4 text-left text-xs font-medium leading-[18px] text-muted-foreground", className)}
      {...props}
    />
  );
}
export function TableCell({ className, ...props }: ComponentProps<"td">) {
  return <td className={cn("py-4 pr-4 align-middle text-muted-foreground", className)} {...props} />;
}
/** First-column emphasis, e.g. "#FL-0268 · Vegetable rice". */
export function TableCellStrong({ className, ...props }: ComponentProps<"td">) {
  return <td className={cn("py-4 pr-4 align-middle font-medium text-foreground", className)} {...props} />;
}
