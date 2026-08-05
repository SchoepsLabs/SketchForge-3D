import { describe, expect, it } from "vitest";
import {
  appendAssistantCheckpoint,
  assistantCheckpointTag,
  assistantRestoreLabel,
  assistantVersionOptions,
  findAssistantVersion,
  ASSISTANT_CURRENT_VERSION_ID,
  type AssistantCheckpoint,
} from "@/lib/assistantCheckpoints";
import type { WorkplaneShape } from "@/types/sketchforge";

function box(overrides: Partial<WorkplaneShape> = {}): WorkplaneShape {
  return {
    id: "box-1",
    name: "Box",
    kind: "box",
    color: "#d41721",
    x: 0,
    z: 0,
    elevation: 0,
    size: 20,
    width: 20,
    depth: 20,
    height: 20,
    rotation: 0,
    locked: false,
    hidden: false,
    ...overrides,
  };
}

/** Three assistant edits: empty scene → one box → two boxes → two boxes, one taller. */
function threeIterations() {
  const v0: WorkplaneShape[] = [];
  const v1 = [box()];
  const v2 = [box(), box({ id: "box-2", x: 40 })];
  const v3 = [box({ height: 30 }), box({ id: "box-2", x: 40 })];

  let checkpoints: AssistantCheckpoint[] = [];
  checkpoints = appendAssistantCheckpoint(checkpoints, { id: "c1", prompt: "add a 20mm box", before: v0, after: v1, createdAt: 1 });
  checkpoints = appendAssistantCheckpoint(checkpoints, { id: "c2", prompt: "add a second box 40mm over", before: v1, after: v2, createdAt: 2 });
  checkpoints = appendAssistantCheckpoint(checkpoints, { id: "c3", prompt: "make the first one 30mm tall", before: v2, after: v3, createdAt: 3 });
  return { checkpoints, v0, v1, v2, v3 };
}

describe("appendAssistantCheckpoint", () => {
  it("numbers iterations from 1", () => {
    const { checkpoints } = threeIterations();
    expect(checkpoints.map((checkpoint) => checkpoint.index)).toEqual([1, 2, 3]);
    expect(assistantCheckpointTag(checkpoints[2])).toBe("assistant#3");
  });

  it("skips a turn that did not change the scene", () => {
    const shapes = [box()];
    const checkpoints = appendAssistantCheckpoint([], { id: "c1", prompt: "how tall is the box?", before: shapes, after: [box()], createdAt: 1 });
    expect(checkpoints).toEqual([]);
  });

  it("records a turn that only moved a shape", () => {
    const checkpoints = appendAssistantCheckpoint([], { id: "c1", prompt: "nudge it", before: [box()], after: [box({ x: 5 })], createdAt: 1 });
    expect(checkpoints).toHaveLength(1);
  });

  it("keeps the scene it was handed, so a later manual edit cannot rewrite a version", () => {
    const before = [box()];
    const { checkpoints } = { checkpoints: appendAssistantCheckpoint([], { id: "c1", prompt: "p", before, after: [box(), box({ id: "box-2" })], createdAt: 1 }) };
    expect(checkpoints[0].before).toEqual([box()]);
    expect(checkpoints[0].after).toHaveLength(2);
  });
});

describe("assistantVersionOptions", () => {
  it("is empty until the assistant has changed something", () => {
    expect(assistantVersionOptions([])).toEqual([]);
  });

  it("lists current, then each iteration newest first, then the pre-assistant scene", () => {
    const { checkpoints } = threeIterations();
    expect(assistantVersionOptions(checkpoints).map((option) => option.label)).toEqual(["Current", "v3", "v2", "v1", "Before v1"]);
  });

  it("restores the state an iteration produced, not the state it started from", () => {
    const { checkpoints, v1, v3 } = threeIterations();
    expect(findAssistantVersion(checkpoints, "c1")?.shapes).toEqual(v1);
    expect(findAssistantVersion(checkpoints, "c3")?.shapes).toEqual(v3);
  });

  it("restores the pre-assistant scene from the first checkpoint's before state", () => {
    const { checkpoints, v0 } = threeIterations();
    const options = assistantVersionOptions(checkpoints);
    expect(options[options.length - 1].shapes).toEqual(v0);
  });

  it("marks the current entry as nothing to restore", () => {
    const { checkpoints } = threeIterations();
    expect(findAssistantVersion(checkpoints, ASSISTANT_CURRENT_VERSION_ID)?.shapes).toBeNull();
  });

  it("labels an iteration with its prompt, clipped to one line", () => {
    const checkpoints = appendAssistantCheckpoint([], {
      id: "c1",
      prompt: `  add a bracket  ${"and another thing ".repeat(6)}`,
      before: [],
      after: [box()],
      createdAt: 1,
    });
    const [, iteration] = assistantVersionOptions(checkpoints);
    expect(iteration.detail.startsWith("add a bracket and another thing")).toBe(true);
    expect(iteration.detail.length).toBeLessThanOrEqual(48);
    expect(iteration.detail.endsWith("…")).toBe(true);
  });

  it("survives an empty prompt rather than rendering a blank row", () => {
    const checkpoints = appendAssistantCheckpoint([], { id: "c1", prompt: "   ", before: [], after: [box()], createdAt: 1 });
    expect(assistantVersionOptions(checkpoints)[1].detail).toBe("(no prompt)");
  });

  it("returns null for an id that is not in the list", () => {
    const { checkpoints } = threeIterations();
    expect(findAssistantVersion(checkpoints, "nope")).toBeNull();
  });
});

describe("assistantRestoreLabel", () => {
  it("names the iteration being restored, which is what the undo entry is called", () => {
    const { checkpoints } = threeIterations();
    const options = assistantVersionOptions(checkpoints);
    expect(assistantRestoreLabel(options[1])).toBe("Restored assistant v3 (make the first one 30mm tall)");
    expect(assistantRestoreLabel(options[options.length - 1])).toBe("Restored the scene from before the first assistant edit");
  });
});
