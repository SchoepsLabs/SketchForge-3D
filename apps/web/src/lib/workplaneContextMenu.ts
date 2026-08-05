import type { ContextMenuItem } from "@/components/workplane/ContextMenu";

/**
 * Which entries the workplane right-click menu shows, and which are greyed out.
 *
 * Kept out of the component so the enablement rules can be tested, and so they
 * can be read next to each other: every rule here mirrors the one the toolbar
 * already applies to the same action, because the menu calls the same callbacks.
 */

export type ContextMenuSelectionState = {
  selectedCount: number;
  /** Every selected shape is locked — locked shapes refuse edits. */
  allLocked: boolean;
  anyLocked: boolean;
  /** Every selected shape is already a hole, so only "Make solid" is useful. */
  allHoles: boolean;
  canGroup: boolean;
  canUngroup: boolean;
  canSeparateParts: boolean;
};

export type ContextMenuActions = {
  duplicate: () => void;
  delete: () => void;
  group: () => void;
  ungroup: () => void;
  separateParts: () => void;
  makeHole: () => void;
  makeSolid: () => void;
  toggleLock: () => void;
  hide: () => void;
  dropToWorkplane: () => void;
  centerOnPlate: () => void;
};

export function buildWorkplaneContextMenuItems(
  state: ContextMenuSelectionState,
  actions: ContextMenuActions,
): ContextMenuItem[] {
  if (state.selectedCount < 1) return [];

  const editable = !state.allLocked;

  return [
    { id: "duplicate", label: "Duplicate", disabled: !editable, onSelect: actions.duplicate },
    { id: "delete", label: "Delete", danger: true, disabled: !editable, onSelect: actions.delete },
    { kind: "separator", id: "sep-combine" },
    { id: "group", label: "Group", disabled: !state.canGroup, onSelect: actions.group },
    { id: "ungroup", label: "Ungroup", disabled: !state.canUngroup, onSelect: actions.ungroup },
    { id: "split", label: "Split parts", disabled: !state.canSeparateParts, onSelect: actions.separateParts },
    { kind: "separator", id: "sep-modify" },
    // One toggle rather than two entries: the useful action is always the one
    // the selection is not already in.
    state.allHoles
      ? { id: "solid", label: "Make solid", disabled: !editable, onSelect: actions.makeSolid }
      : { id: "hole", label: "Make hole", disabled: !editable, onSelect: actions.makeHole },
    // Lock stays enabled while locked — it is the way back out.
    { id: "lock", label: state.allLocked ? "Unlock" : "Lock", onSelect: actions.toggleLock },
    { id: "hide", label: "Hide", onSelect: actions.hide },
    { kind: "separator", id: "sep-arrange" },
    { id: "drop", label: "Drop to workplane", disabled: !editable, onSelect: actions.dropToWorkplane },
    { id: "center", label: "Center on plate", disabled: !editable, onSelect: actions.centerOnPlate },
  ];
}
