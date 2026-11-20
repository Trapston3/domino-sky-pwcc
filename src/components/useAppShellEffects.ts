import { useEffect } from 'react';
import type { ThemeMode, ViewMode } from './ScenarioBar.js';

interface UseAppShellEffectsOptions {
  theme: ThemeMode;
  viewMode: ViewMode;
  onReducedMotionChange: (reduced: boolean) => void;
  onRightInsetChange: (insetPx: number) => void;
  onSpaceTogglePlay: () => void;
}

/** Syncs document theme, reduced-motion preference, responsive rail inset, and Spacebar playback shortcut. */
export function useAppShellEffects({
  theme,
  viewMode,
  onReducedMotionChange,
  onRightInsetChange,
  onSpaceTogglePlay,
}: UseAppShellEffectsOptions): void {
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme === 'night' ? 'dark' : 'light';
  }, [theme]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e: MediaQueryListEvent) => onReducedMotionChange(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [onReducedMotionChange]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => onRightInsetChange(window.innerWidth >= 1024 ? 412 : 0);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [onRightInsetChange]);

  useEffect(() => {
    if (viewMode !== 'map') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== ' ') return;
      const target = e.target;
      if (
        target instanceof HTMLElement &&
        (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A'].includes(target.tagName) ||
          target.isContentEditable ||
          target.getAttribute('role') === 'slider')
      ) {
        return;
      }
      e.preventDefault();
      onSpaceTogglePlay();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [viewMode, onSpaceTogglePlay]);
}
