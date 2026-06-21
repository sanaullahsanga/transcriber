import { cn } from "@/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
  {
    variants: {
      variant: {
        default: "bg-violet-500/15 text-violet-200 ring-violet-500/30",
        pending: "bg-amber-500/15 text-amber-200 ring-amber-500/30",
        processing: "bg-sky-500/15 text-sky-200 ring-sky-500/30 animate-pulse",
        completed: "bg-emerald-500/15 text-emerald-200 ring-emerald-500/30",
        failed: "bg-rose-500/15 text-rose-200 ring-rose-500/30",
        muted: "bg-white/5 text-zinc-400 ring-white/10",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
