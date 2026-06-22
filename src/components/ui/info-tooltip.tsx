"use client";

import { CircleHelp } from "lucide-react";
import { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

type InfoTooltipProps = {
  content: string;
  className?: string;
};

export function InfoTooltip({ content, className }: InfoTooltipProps) {
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  const show = () => {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    setPosition({
      top: rect.bottom + 8,
      left: rect.left + rect.width / 2,
    });
    setOpen(true);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={cn(
          "inline-flex shrink-0 text-zinc-500 transition-colors hover:text-zinc-300 focus-visible:text-zinc-300 focus-visible:outline-none",
          className,
        )}
        aria-describedby={open ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={() => setOpen(false)}
        onFocus={show}
        onBlur={() => setOpen(false)}
      >
        <CircleHelp className="h-3.5 w-3.5" />
        <span className="sr-only">More information</span>
      </button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <span
            id={id}
            role="tooltip"
            style={{
              top: position.top,
              left: position.left,
              transform: "translateX(-50%)",
            }}
            className="pointer-events-none fixed z-[100] w-60 rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 text-xs font-normal leading-relaxed text-zinc-300 shadow-xl"
          >
            {content}
          </span>,
          document.body,
        )}
    </>
  );
}
