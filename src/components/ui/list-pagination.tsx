"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PaginationMeta } from "@/lib/pagination";
import { cn } from "@/lib/utils";

type ListPaginationProps = {
  pagination: PaginationMeta | null;
  loading?: boolean;
  onLoadMore: () => void;
  className?: string;
};

export function ListPagination({
  pagination,
  loading = false,
  onLoadMore,
  className,
}: ListPaginationProps) {
  if (!pagination || pagination.total === 0) return null;

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-t border-white/5 pt-3",
        className,
      )}
    >
      <p className="text-xs text-zinc-500">
        <span className="text-zinc-400">{Math.min(pagination.loaded, pagination.total)}</span>
        {" of "}
        {pagination.total}
      </p>
      {pagination.hasMore ? (
        <Button variant="secondary" size="sm" disabled={loading} onClick={onLoadMore}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Load more
        </Button>
      ) : (
        <span className="text-xs text-zinc-600">All loaded</span>
      )}
    </div>
  );
}
