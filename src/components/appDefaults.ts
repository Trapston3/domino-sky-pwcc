/** Reads the user's reduced-motion preference without requiring a browser environment. */
export function getInitialReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Chooses the initial optimizer inset for the current viewport. */
export function getInitialRightInset(): number {
  if (typeof window === 'undefined') return 412;
  return window.innerWidth >= 1024 ? 412 : 0;
}
