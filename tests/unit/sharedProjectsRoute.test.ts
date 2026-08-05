import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/shared-projects/route";
import { exportSkfProject } from "@/lib/skfProject";
import { DEFAULT_WORKPLANE_WORKSPACE } from "@/lib/workplaneSettings";
import type { WorkplaneShape } from "@/types/sketchforge";

/**
 * Exercises the save path end to end against a real directory, because this is
 * the one route in the app that writes files the user cares about keeping.
 */

const ENV = "SKETCHFORGE_SHARED_PROJECTS_DIR";
const root = mkdtempSync(path.join(tmpdir(), "sketchforge-shared-test-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function box(): WorkplaneShape {
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
  };
}

async function skfBytes(projectName: string) {
  return exportSkfProject({
    projectId: null,
    projectName,
    createdAt: 1_785_000_000_000,
    modifiedAt: 1_785_000_000_000,
    shapes: [box()],
    history: undefined,
    historyIndex: undefined,
    assets: [],
    workspace: DEFAULT_WORKPLANE_WORKSPACE,
    snapGrid: "1.0 mm",
    placementElevation: 0,
    placementWorkplane: undefined,
    sketchPlacementWorkplane: undefined,
  });
}

async function save(fileName: string, bytes: Uint8Array, headers: Record<string, string> = {}) {
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const response = await POST(
    new Request(`http://localhost:3001/api/shared-projects?fileName=${encodeURIComponent(fileName)}`, {
      method: "POST",
      headers: { "Content-Type": "application/vnd.sketchforge.project+zip", ...headers },
      body,
    }),
  );
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, payload, etag: response.headers.get("ETag") };
}

describe("shared project save", () => {
  beforeEach(() => {
    process.env[ENV] = root;
  });

  it("explains how to switch shared storage on when it is off", async () => {
    delete process.env[ENV];
    const bytes = await skfBytes("bracket");
    const { status, payload } = await save("bracket.skf", bytes);
    expect(status).toBe(404);
    expect(payload.reason).toBe("disabled");
    expect(String(payload.error)).toContain(ENV);
  });

  it("creates a new shared project", async () => {
    const { status, payload } = await save("create-me.skf", await skfBytes("create-me"), { "If-None-Match": "*" });
    expect(status).toBe(201);
    expect((payload.project as { fileName: string }).fileName).toBe("create-me.skf");
  });

  it("reports a taken name as its own case, with the revision an overwrite needs", async () => {
    const bytes = await skfBytes("taken");
    await save("taken.skf", bytes, { "If-None-Match": "*" });
    const second = await save("taken.skf", bytes, { "If-None-Match": "*" });

    expect(second.status).toBe(409);
    // The distinction the confirm bar depends on: this is a question, not a
    // lost-update conflict, and it carries what an overwrite must match.
    expect(second.payload.reason).toBe("name-taken");
    expect(typeof second.payload.currentRevision).toBe("string");
    expect(String(second.payload.error)).toContain("taken");
  });

  it("overwrites when the client answers yes with the named revision", async () => {
    const bytes = await skfBytes("overwrite-me");
    await save("overwrite-me.skf", bytes, { "If-None-Match": "*" });
    const conflict = await save("overwrite-me.skf", bytes, { "If-None-Match": "*" });
    const revision = conflict.payload.currentRevision as string;

    const overwritten = await save("overwrite-me.skf", await skfBytes("overwrite-me"), { "If-Match": `"${revision}"` });
    expect(overwritten.status).toBe(200);
    expect((overwritten.payload.project as { fileName: string }).fileName).toBe("overwrite-me.skf");
  });

  it("still refuses a stale revision, so a real lost update cannot happen", async () => {
    const bytes = await skfBytes("stale");
    await save("stale.skf", bytes, { "If-None-Match": "*" });
    const stale = await save("stale.skf", bytes, { "If-Match": '"not-the-current-revision"' });

    expect(stale.status).toBe(409);
    expect(stale.payload.reason).toBe("stale-revision");
  });

  it("refuses an If-Match against a name that does not exist", async () => {
    const gone = await save("never-existed.skf", await skfBytes("never-existed"), { "If-Match": '"whatever"' });
    expect(gone.status).toBe(409);
    expect(gone.payload.reason).toBe("missing");
  });
});
