import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { RecoveryRecommendation } from '../engine/types.js';
import type { ThemeMode, ViewMode } from './ScenarioBar.js';

interface AppViewActionsInput {
  theme: ThemeMode;
  viewMode: ViewMode;
  canvasUnavailable: boolean;
  setTheme: Dispatch<SetStateAction<ThemeMode>>;
  setViewMode: Dispatch<SetStateAction<ViewMode>>;
  setCanvasUnavailable: Dispatch<SetStateAction<boolean>>;
  setIsPlaying: Dispatch<SetStateAction<boolean>>;
  setIs3D: Dispatch<SetStateAction<boolean>>;
  setAnnouncement: Dispatch<SetStateAction<string>>;
}

/** Creates stable view and map control actions for the application shell. */
export function useAppViewActions({
  theme,
  viewMode,
  canvasUnavailable,
  setTheme,
  setViewMode,
  setCanvasUnavailable,
  setIsPlaying,
  setIs3D,
  setAnnouncement,
}: AppViewActionsInput) {
  const handleCanvasError = useCallback(() => {
    setCanvasUnavailable(true);
    setViewMode('plain');
    setIsPlaying(false);
    setAnnouncement('2D map canvas unavailable; switched to Plain Stats mode.');
  }, [setAnnouncement, setCanvasUnavailable, setIsPlaying, setViewMode]);

  const handleToggleTheme = useCallback(() => {
    const next: ThemeMode = theme === 'night' ? 'day' : 'night';
    setTheme(next);
    setAnnouncement(`Switched to ${next === 'night' ? 'Night' : 'Day'} theme.`);
  }, [setAnnouncement, setTheme, theme]);

  const handleToggleViewMode = useCallback(() => {
    if (canvasUnavailable && viewMode === 'plain') return;
    const next: ViewMode = viewMode === 'map' ? 'plain' : 'map';
    setViewMode(next);
    if (next === 'plain') setIsPlaying(false);
    setAnnouncement(`Switched to ${next === 'map' ? 'Map view' : 'Plain stats mode'}.`);
  }, [canvasUnavailable, setAnnouncement, setIsPlaying, setViewMode, viewMode]);

  const handleToggle3D = useCallback(() => setIs3D((prev) => !prev), [setIs3D]);
  const handleFocusPreview = useCallback((rec: RecoveryRecommendation) => {
    setAnnouncement(`Previewing recovery recommendation: ${rec.title}.`);
  }, [setAnnouncement]);

  return { handleCanvasError, handleToggleTheme, handleToggleViewMode, handleToggle3D, handleFocusPreview };
}
