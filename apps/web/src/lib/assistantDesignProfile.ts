import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Shop knowledge injected into the assistant's system prompt.
 *
 * `docs/assistant/H2D_DESIGN_PROFILE.md` holds the printer's real numbers — wall
 * multiples, hole compensation, fit clearances, the house Ø96 standard. Loading
 * it from disk per request (rather than baking it into the prompt builder) means
 * editing the markdown changes the assistant's behaviour on the next message,
 * with no rebuild and no client bundle cost.
 *
 * Server-side only: this module touches `node:fs`.
 */

export const DEFAULT_DESIGN_PROFILE_RELATIVE_PATH = path.join("docs", "assistant", "H2D_DESIGN_PROFILE.md");

/** A profile past this size would crowd out the scene summary; truncate rather than drop. */
export const MAX_DESIGN_PROFILE_CHARS = 20000;

export function resolveDesignProfilePath({
  configuredPath,
  cwd,
}: {
  configuredPath?: string | null;
  cwd: string;
}) {
  const trimmed = configuredPath?.trim();
  if (trimmed) return path.resolve(trimmed);
  return path.resolve(cwd, DEFAULT_DESIGN_PROFILE_RELATIVE_PATH);
}

export function clampDesignProfile(text: string, maxChars = MAX_DESIGN_PROFILE_CHARS) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars)}\n\n[profile truncated at ${maxChars} characters]`;
}

/**
 * Reads the profile, or returns null when there isn't one. A missing profile is
 * not an error: the dock still works, it just doesn't know the shop's numbers.
 */
export function loadDesignProfile({
  configuredPath = process.env.SKETCHFORGE_DESIGN_PROFILE,
  cwd = process.cwd(),
}: { configuredPath?: string | null; cwd?: string } = {}) {
  const file = resolveDesignProfilePath({ configuredPath, cwd });
  if (!existsSync(file)) return null;
  try {
    return clampDesignProfile(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}
