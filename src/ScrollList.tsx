import { t } from "./i18n";
import React, { useCallback, useEffect, useRef } from "react";

export function ScrollList({
  children,
  className = "",
  label,
}: {
  children: React.ReactNode;
  className?: string;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const update = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    const { top, bottom } = node.getBoundingClientRect();
    const above = node.scrollTop > 2;
    const below = node.scrollTop + node.clientHeight < node.scrollHeight - 2;
    node.dataset.above = String(above);
    node.dataset.below = String(below);
    Array.from(node.children).forEach((child) => {
      const row = child as HTMLElement;
      const rect = row.getBoundingClientRect();
      const distance = Math.min(
        above ? rect.bottom - top : 100,
        below ? bottom - rect.top : 100,
      );
      const visibility = Math.max(0, Math.min(1, distance / 52));
      row.style.setProperty("--row-opacity", String(0.15 + visibility * 0.85));
      row.style.setProperty("--row-blur", `${(1 - visibility) * 3}px`);
    });
  }, []);
  useEffect(() => {
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    if (ref.current) observer.observe(ref.current);
    if (ref.current)
      Array.from(ref.current.children).forEach((child) =>
        observer.observe(child),
      );
    return () => observer.disconnect();
  }, [children, update]);
  return (
    <div
      ref={ref}
      className={`scroll-list ${className}`}
      role="region"
      aria-label={t(label)}
      tabIndex={0}
      onScroll={update}
      onFocusCapture={(event) => {
        if (event.target !== event.currentTarget)
          (event.target as HTMLElement).scrollIntoView?.({ block: "center" });
      }}
    >
      {children}
    </div>
  );
}
