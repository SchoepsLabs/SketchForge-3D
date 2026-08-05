import { describe, expect, it, vi } from "vitest";
import { buildWorkplaneContextMenuItems, type ContextMenuActions, type ContextMenuSelectionState } from "@/lib/workplaneContextMenu";

function actions(): ContextMenuActions {
  return {
    duplicate: vi.fn(),
    delete: vi.fn(),
    group: vi.fn(),
    ungroup: vi.fn(),
    separateParts: vi.fn(),
    makeHole: vi.fn(),
    makeSolid: vi.fn(),
    toggleLock: vi.fn(),
    hide: vi.fn(),
    dropToWorkplane: vi.fn(),
    centerOnPlate: vi.fn(),
  };
}

function state(overrides: Partial<ContextMenuSelectionState> = {}): ContextMenuSelectionState {
  return {
    selectedCount: 1,
    allLocked: false,
    anyLocked: false,
    allHoles: false,
    canGroup: false,
    canUngroup: false,
    canSeparateParts: false,
    ...overrides,
  };
}

function itemById(items: ReturnType<typeof buildWorkplaneContextMenuItems>, id: string) {
  const item = items.find((entry) => entry.id === id);
  if (!item || item.kind === "separator") throw new Error(`no menu item ${id}`);
  return item;
}

describe("buildWorkplaneContextMenuItems", () => {
  it("shows nothing without a selection", () => {
    expect(buildWorkplaneContextMenuItems(state({ selectedCount: 0 }), actions())).toEqual([]);
  });

  it("offers every action the roadmap asked for", () => {
    const items = buildWorkplaneContextMenuItems(state(), actions())
      .filter((item) => item.kind !== "separator")
      .map((item) => item.id);
    expect(items).toEqual(["duplicate", "delete", "group", "ungroup", "split", "hole", "lock", "hide", "drop", "center"]);
  });

  it("wires each entry to the editor callback, not to logic of its own", () => {
    const callbacks = actions();
    const items = buildWorkplaneContextMenuItems(state(), callbacks);
    itemById(items, "duplicate").onSelect();
    itemById(items, "center").onSelect();
    expect(callbacks.duplicate).toHaveBeenCalledOnce();
    expect(callbacks.centerOnPlate).toHaveBeenCalledOnce();
  });

  it("greys out the edits a locked selection would refuse", () => {
    const items = buildWorkplaneContextMenuItems(state({ allLocked: true }), actions());
    expect(itemById(items, "duplicate").disabled).toBe(true);
    expect(itemById(items, "delete").disabled).toBe(true);
    expect(itemById(items, "drop").disabled).toBe(true);
    expect(itemById(items, "center").disabled).toBe(true);
  });

  it("keeps Lock usable while locked, because it is the way back out", () => {
    const locked = buildWorkplaneContextMenuItems(state({ allLocked: true }), actions());
    expect(itemById(locked, "lock").label).toBe("Unlock");
    expect(itemById(locked, "lock").disabled).toBeUndefined();
    expect(itemById(buildWorkplaneContextMenuItems(state(), actions()), "lock").label).toBe("Lock");
  });

  it("offers the hole/solid direction the selection is not already in", () => {
    const solidSelection = buildWorkplaneContextMenuItems(state(), actions());
    expect(itemById(solidSelection, "hole").label).toBe("Make hole");
    expect(solidSelection.some((item) => item.id === "solid")).toBe(false);

    const holeSelection = buildWorkplaneContextMenuItems(state({ allHoles: true }), actions());
    expect(itemById(holeSelection, "solid").label).toBe("Make solid");
    expect(holeSelection.some((item) => item.id === "hole")).toBe(false);
  });

  it("mirrors the toolbar's combine rules", () => {
    const none = buildWorkplaneContextMenuItems(state(), actions());
    expect(itemById(none, "group").disabled).toBe(true);
    expect(itemById(none, "ungroup").disabled).toBe(true);
    expect(itemById(none, "split").disabled).toBe(true);

    const combinable = buildWorkplaneContextMenuItems(
      state({ selectedCount: 2, canGroup: true, canUngroup: true, canSeparateParts: true }),
      actions(),
    );
    expect(itemById(combinable, "group").disabled).toBe(false);
    expect(itemById(combinable, "ungroup").disabled).toBe(false);
    expect(itemById(combinable, "split").disabled).toBe(false);
  });

  it("groups the entries with separators instead of one long list", () => {
    const items = buildWorkplaneContextMenuItems(state(), actions());
    expect(items.filter((item) => item.kind === "separator")).toHaveLength(3);
  });
});
