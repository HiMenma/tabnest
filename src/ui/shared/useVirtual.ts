import { useCallback, useEffect, useRef, useState } from "react";

export interface VirtualRange {
  start: number;
  end: number;
}

/**
 * Fixed-height windowing. Deliberately tiny: a scroll handler, a resize observer
 * and a rAF throttle. No dependency, no measurement of individual rows, which is
 * why the list can hold thousands of rows without jank.
 */
export function useVirtual(count: number, rowHeight: number, overscan = 8) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [range, setRange] = useState<VirtualRange>({ start: 0, end: Math.min(count, 40) });
  const frame = useRef<number | null>(null);

  const measure = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    const viewport = element.clientHeight || 600;
    const first = Math.floor(element.scrollTop / rowHeight);
    const visible = Math.ceil(viewport / rowHeight);
    const start = Math.max(0, first - overscan);
    const end = Math.min(count, first + visible + overscan);
    setRange((previous) =>
      previous.start === start && previous.end === end ? previous : { start, end },
    );
  }, [count, rowHeight, overscan]);

  const onScroll = useCallback(() => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      measure();
    });
  }, [measure]);

  useEffect(() => {
    measure();
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(element);
    return () => observer.disconnect();
  }, [measure]);

  useEffect(() => {
    setRange((previous) => {
      const end = Math.min(count, Math.max(previous.end, Math.min(count, 40)));
      return { start: Math.min(previous.start, count), end };
    });
  }, [count]);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  return { ref, range, onScroll, totalHeight: count * rowHeight, rowHeight };
}
