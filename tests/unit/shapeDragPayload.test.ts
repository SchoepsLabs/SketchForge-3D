import { beforeEach, describe, expect, it } from "vitest";
import {
  clearActiveShapeDragAsset,
  isShapeDragTransfer,
  parseShapeDragPayload,
  readActiveShapeDragAsset,
  serializeShapeDragAsset,
  setActiveShapeDragAsset,
  SHAPE_DRAG_MIME,
} from "@/lib/shapeDragPayload";
import type { ShapeAsset } from "@/types/sketchforge";

const boxAsset: ShapeAsset = {
  id: "box",
  name: "Box",
  src: "/shapes/box.png",
  kind: "box",
  color: "#d41721",
};

describe("shape drag payload", () => {
  it("round-trips an asset through the drag data", () => {
    expect(parseShapeDragPayload(serializeShapeDragAsset(boxAsset))).toEqual(boxAsset);
  });

  it("keeps the optional hole flag", () => {
    const hole: ShapeAsset = { ...boxAsset, id: "box-hole", hole: true };
    expect(parseShapeDragPayload(serializeShapeDragAsset(hole))?.hole).toBe(true);
  });

  it("rejects payloads that are not a shape asset", () => {
    expect(parseShapeDragPayload("not json")).toBeNull();
    expect(parseShapeDragPayload("null")).toBeNull();
    expect(parseShapeDragPayload("[1,2]")).toBeNull();
    expect(parseShapeDragPayload(JSON.stringify({ ...boxAsset, kind: "banana" }))).toBeNull();
    expect(parseShapeDragPayload(JSON.stringify({ ...boxAsset, hole: "yes" }))).toBeNull();
    expect(parseShapeDragPayload(JSON.stringify({ name: "Box" }))).toBeNull();
  });

  it("recognises our drag by type, which is all dragover exposes", () => {
    // During dragover the browser is in protected mode: getData() returns "",
    // only types can be inspected.
    expect(isShapeDragTransfer([SHAPE_DRAG_MIME, "text/plain"])).toBe(true);
    expect(isShapeDragTransfer(["Files"])).toBe(false);
    expect(isShapeDragTransfer(undefined)).toBe(false);
    expect(isShapeDragTransfer(null)).toBe(false);
  });

  it("works with a DOMStringList-shaped value, not just an array", () => {
    const domStringList = { 0: SHAPE_DRAG_MIME, length: 1 } as unknown as DOMStringList;
    expect(isShapeDragTransfer(domStringList)).toBe(true);
  });
});

describe("active drag register", () => {
  beforeEach(() => clearActiveShapeDragAsset());

  it("hands the dragged asset to the viewport while the drag is in flight", () => {
    expect(readActiveShapeDragAsset()).toBeNull();
    setActiveShapeDragAsset(boxAsset);
    expect(readActiveShapeDragAsset()).toEqual(boxAsset);
  });

  it("clears on drag end so a stale asset cannot ghost the next drag", () => {
    setActiveShapeDragAsset(boxAsset);
    clearActiveShapeDragAsset();
    expect(readActiveShapeDragAsset()).toBeNull();
  });
});
