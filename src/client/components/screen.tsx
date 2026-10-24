import { startTransition, useEffect, useState, type ReactNode } from "react";

// Give the destination a rendering opportunity before starting live queries, building indexes
// or mounting large lists. Unlike an idle callback, this also progresses on a busy page. The
// enrichment is interruptible so a later navigation can take precedence.
export function useScreenReady() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => startTransition(() => setReady(true)));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, []);
  return ready;
}

export function Screen({ preview, children }: { preview: ReactNode; children: ReactNode }) {
  return useScreenReady() ? children : preview;
}
