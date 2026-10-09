/** Setup intent is separate from observed scheduling and relay permissions. */
export function backgroundSelectionForConfiguration(configuration: {
  version: number;
  settings: {
    setup_background?: { enabled: boolean; interval_minutes: number | null } | null;
    background: { method: string; interval_minutes: number | null };
  };
} | null) {
  if (!configuration) return undefined;
  const saved = configuration.settings.setup_background;
  if (saved) return { enabled: saved.enabled, intervalMinutes: saved.interval_minutes };
  // Preserve established preferences; provider defaults apply to a fresh setup.
  if (configuration.version > 0) return {
    enabled: configuration.settings.background.method === "scheduled",
    intervalMinutes: configuration.settings.background.interval_minutes,
  };
  return undefined;
}
