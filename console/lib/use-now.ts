"use client";

import { useEffect, useState } from "react";

/** The server only speaks on state changes, so elapsed labels need their own clock. */
export function useNow(ticking: boolean) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [ticking]);

  return now;
}
