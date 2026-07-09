"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Shared modal shell. Rendered via a portal to <body> so it escapes the
 * backdrop-blurred TopNav header (backdrop-blur creates a containing block for
 * position:fixed). z-[1300] sits above the CopilotKit sidebar (z-1200). Opaque
 * bg-white panel (bg-content1 resolves transparent without the HeroUI provider).
 * Desktop: centered card. Mobile: bottom sheet. Escape + scroll-lock handled here;
 * children fill the flex column below the header (own their tabs / scroll region).
 */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  testId,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  testId?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid={testId}
      className="fixed inset-0 z-[1300] flex items-end justify-center sm:items-center sm:p-4"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
      />
      <div className="border-default-200 relative flex max-h-[88vh] w-full flex-col overflow-hidden rounded-t-2xl border bg-white shadow-xl sm:max-h-[85vh] sm:max-w-2xl sm:rounded-2xl">
        <div className="border-default-200 flex items-start justify-between gap-3 border-b px-5 py-4">
          <div>
            <h2 className="text-foreground text-base font-semibold">{title}</h2>
            {subtitle && <p className="text-default-500 mt-0.5 text-sm">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-default-400 hover:bg-default-100 hover:text-foreground -mr-1 -mt-1 flex size-8 shrink-0 items-center justify-center rounded-lg text-lg"
          >
            ✕
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
