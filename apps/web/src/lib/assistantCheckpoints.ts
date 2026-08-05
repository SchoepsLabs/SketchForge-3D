import { projectShapesFingerprint } from "@/lib/editorHistory";
import type { WorkplaneShape } from "@/types/sketchforge";

/**
 * Iteration checkpoints for the assistant dock.
 *
 * The dock snapshots the scene before each assistant turn and again when the
 * turn ends. A turn that changed nothing (a question, a failed turn) produces no
 * version, so the selector lists design iterations rather than chat messages.
 *
 * Restoring goes back through the editor's normal `commitShapes`, so a restore
 * lands in the undo chain like any other edit — this is deliberately *not* a
 * parallel history, it is a set of bookmarks into one.
 */

export type AssistantCheckpoint = {
  id: string;
  /** 1-based iteration number, shown as v1, v2, … */
  index: number;
  prompt: string;
  /** Scene as it was before this turn ran. */
  before: WorkplaneShape[];
  /** Scene as it was when the turn finished. */
  after: WorkplaneShape[];
  createdAt: number;
};

export type AssistantVersionOption = {
  id: string;
  label: string;
  detail: string;
  /** Null for the synthetic "current" entry, which is where you already are. */
  shapes: WorkplaneShape[] | null;
};

export const ASSISTANT_CURRENT_VERSION_ID = "current";
const ORIGIN_VERSION_ID = "assistant-origin";
const MAX_PROMPT_LABEL_LENGTH = 48;

export function assistantCheckpointTag(checkpoint: AssistantCheckpoint) {
  return `assistant#${checkpoint.index}`;
}

function shortPrompt(prompt: string) {
  const collapsed = prompt.replace(/\s+/g, " ").trim();
  if (!collapsed) return "(no prompt)";
  return collapsed.length > MAX_PROMPT_LABEL_LENGTH ? `${collapsed.slice(0, MAX_PROMPT_LABEL_LENGTH - 1)}…` : collapsed;
}

/**
 * Append a checkpoint for a finished turn, or return the list unchanged when
 * the turn left the scene exactly as it found it.
 */
export function appendAssistantCheckpoint(
  checkpoints: AssistantCheckpoint[],
  { id, prompt, before, after, createdAt }: { id: string; prompt: string; before: WorkplaneShape[]; after: WorkplaneShape[]; createdAt: number },
): AssistantCheckpoint[] {
  if (projectShapesFingerprint(before) === projectShapesFingerprint(after)) {
    return checkpoints;
  }
  return [
    ...checkpoints,
    {
      id,
      index: checkpoints.length + 1,
      prompt,
      before,
      after,
      createdAt,
    },
  ];
}

/**
 * Options for the header dropdown, newest first: where you are now, then each
 * iteration's result, then the scene as it was before the assistant touched it.
 */
export function assistantVersionOptions(checkpoints: AssistantCheckpoint[]): AssistantVersionOption[] {
  if (checkpoints.length === 0) return [];

  const iterations = [...checkpoints]
    .reverse()
    .map((checkpoint) => ({
      id: checkpoint.id,
      label: `v${checkpoint.index}`,
      detail: shortPrompt(checkpoint.prompt),
      shapes: checkpoint.after,
    }));

  return [
    { id: ASSISTANT_CURRENT_VERSION_ID, label: "Current", detail: "latest scene", shapes: null },
    ...iterations,
    { id: ORIGIN_VERSION_ID, label: "Before v1", detail: "scene before the first assistant edit", shapes: checkpoints[0].before },
  ];
}

export function findAssistantVersion(checkpoints: AssistantCheckpoint[], id: string) {
  return assistantVersionOptions(checkpoints).find((option) => option.id === id) ?? null;
}

/** Notice text for the restore, which is what the editor's undo entry is named. */
export function assistantRestoreLabel(option: AssistantVersionOption) {
  return option.id === ORIGIN_VERSION_ID
    ? "Restored the scene from before the first assistant edit"
    : `Restored assistant ${option.label} (${option.detail})`;
}
