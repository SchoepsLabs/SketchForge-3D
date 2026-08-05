import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/print-outbox/route";
import {
  printOutboxDateStamp,
  printOutboxFileName,
  resolvePrintOutboxDir,
  sanitizePrintName,
  uniquePrintFileName,
  PRINT_OUTBOX_DEFAULT_SUBDIR,
  PRINT_OUTBOX_ENV,
} from "@/lib/printOutbox";

const root = mkdtempSync(path.join(tmpdir(), "sketchforge-outbox-test-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("print file naming", () => {
  it("names a file you can identify weeks later", () => {
    expect(printOutboxFileName({ projectName: "Bracket", date: new Date(2026, 7, 5) })).toBe("Bracket-2026-08-05.stl");
  });

  it("says when only the selection was sent", () => {
    expect(printOutboxFileName({ projectName: "Bracket", date: new Date(2026, 7, 5), selectionOnly: true })).toBe("Bracket-selection-2026-08-05.stl");
  });

  it("uses the local date, not UTC's idea of it", () => {
    // Late-evening local time must not stamp tomorrow's date.
    const lateEvening = new Date(2026, 7, 5, 23, 30);
    expect(printOutboxDateStamp(lateEvening)).toBe("2026-08-05");
  });

  it("strips characters that break filenames across platforms", () => {
    expect(sanitizePrintName('bad/name:with*chars?')).toBe("bad_name_with_chars_");
    expect(sanitizePrintName("   ")).toBe("sketchforge");
    expect(sanitizePrintName("x".repeat(200))).toHaveLength(80);
  });

  it("never clobbers an earlier print of the same part on the same day", () => {
    const taken = new Set(["Bracket-2026-08-05.stl", "Bracket-2026-08-05-2.stl"]);
    expect(uniquePrintFileName("Bracket-2026-08-05.stl", (name) => taken.has(name))).toBe("Bracket-2026-08-05-3.stl");
    expect(uniquePrintFileName("Fresh-2026-08-05.stl", (name) => taken.has(name))).toBe("Fresh-2026-08-05.stl");
  });
});

describe("resolvePrintOutboxDir", () => {
  const join = (...parts: string[]) => parts.join("/");

  it("prefers an explicit outbox", () => {
    expect(resolvePrintOutboxDir({ outboxDir: "/print/queue", sharedProjectsDir: "/parts", join })).toBe("/print/queue");
  });

  it("otherwise nests inside the shared parts library, so one mount covers both", () => {
    expect(resolvePrintOutboxDir({ sharedProjectsDir: "/parts", join })).toBe(`/parts/${PRINT_OUTBOX_DEFAULT_SUBDIR}`);
  });

  it("returns null when nothing is configured rather than guessing a folder", () => {
    expect(resolvePrintOutboxDir({ join })).toBeNull();
    expect(resolvePrintOutboxDir({ outboxDir: "  ", sharedProjectsDir: "  ", join })).toBeNull();
  });
});

const ASCII_STL = "solid test\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid test\n";

async function send(fileName: string, body: string) {
  const response = await POST(
    new Request(`http://localhost:3001/api/print-outbox?fileName=${encodeURIComponent(fileName)}`, {
      method: "POST",
      headers: { "Content-Type": "model/stl" },
      body,
    }),
  );
  return { status: response.status, payload: (await response.json()) as Record<string, unknown> };
}

describe("print outbox route", () => {
  beforeEach(() => {
    process.env[PRINT_OUTBOX_ENV] = root;
  });

  it("writes the STL into the outbox", async () => {
    const { status, payload } = await send("Bracket-2026-08-05.stl", ASCII_STL);
    expect(status).toBe(201);
    expect(payload.fileName).toBe("Bracket-2026-08-05.stl");
    expect(readFileSync(path.join(root, "Bracket-2026-08-05.stl"), "utf8")).toContain("endsolid");
  });

  it("suffixes a repeat send instead of overwriting the first one", async () => {
    await send("Repeat-2026-08-05.stl", ASCII_STL);
    const second = await send("Repeat-2026-08-05.stl", ASCII_STL);
    expect(second.payload.fileName).toBe("Repeat-2026-08-05-2.stl");
  });

  it("leaves no temp files behind for a folder watcher to trip over", async () => {
    await send("Clean-2026-08-05.stl", ASCII_STL);
    expect(readdirSync(root).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("rebuilds the name from its stem, so a path cannot escape the outbox", async () => {
    const { payload } = await send("../../escape.stl", ASCII_STL);
    expect(String(payload.fileName)).not.toContain("..");
    expect(String(payload.fileName)).not.toContain("/");
  });

  it("rejects an empty body", async () => {
    const { status } = await send("Empty-2026-08-05.stl", "");
    expect(status).toBe(400);
  });

  it("explains how to switch the outbox on when it is not configured", async () => {
    delete process.env[PRINT_OUTBOX_ENV];
    delete process.env.SKETCHFORGE_SHARED_PROJECTS_DIR;
    const { status, payload } = await send("Nope-2026-08-05.stl", ASCII_STL);
    expect(status).toBe(404);
    expect(String(payload.error)).toContain(PRINT_OUTBOX_ENV);
  });
});
