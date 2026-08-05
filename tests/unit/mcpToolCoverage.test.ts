import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the three-way drift between the protocol union, the MCP server's tool
 * list, and the editor's command handler.
 *
 * This is not hypothetical: on 2026-08-05 `send_to_print` was added to the
 * protocol and the server, the editor handler landed in the same session, and
 * the failure ("Unknown MCP command") only showed up in a live call. Adding a
 * command in two of the three places is the natural mistake, so it gets a test.
 */

const repoRoot = path.resolve(__dirname, "../..");
const read = (relative: string) => readFileSync(path.join(repoRoot, relative), "utf8");

const protocolSource = read(path.join("apps", "web", "src", "lib", "sketchforgeMcpProtocol.ts"));
const serverSource = read(path.join("scripts", "sketchforge-mcp-server.mjs"));
const editorSource = read(path.join("apps", "web", "src", "components", "SketchForgeEditor.tsx"));

/** The `SketchForgeMcpCommandName` union members. */
function protocolCommands() {
  const block = protocolSource.match(/export type SketchForgeMcpCommandName =([\s\S]*?);/);
  if (!block) throw new Error("SketchForgeMcpCommandName union not found");
  return [...block[1].matchAll(/"([a-z_]+)"/g)].map((match) => match[1]).sort();
}

/** Commands the MCP server actually dispatches, via bridgeCommand("<name>", …). */
function serverCommands() {
  return [...serverSource.matchAll(/bridgeCommand\("([a-z_]+)"/g)].map((match) => match[1]).sort();
}

/** Commands the editor handles, via command.action === "<name>". */
function editorCommands() {
  return [...editorSource.matchAll(/command\.action === "([a-z_]+)"/g)].map((match) => match[1]).sort();
}

describe("MCP command coverage", () => {
  it("finds the command lists in all three places", () => {
    expect(protocolCommands().length).toBeGreaterThan(10);
    expect(serverCommands().length).toBeGreaterThan(10);
    expect(editorCommands().length).toBeGreaterThan(10);
  });

  it("every protocol command is dispatched by the MCP server", () => {
    const missing = protocolCommands().filter((name) => !serverCommands().includes(name));
    expect(missing).toEqual([]);
  });

  it("every protocol command is handled by the editor", () => {
    // The failure this catches: a tool the assistant can call that the editor
    // answers with "Unknown MCP command".
    const missing = protocolCommands().filter((name) => !editorCommands().includes(name));
    expect(missing).toEqual([]);
  });

  it("the server dispatches nothing the protocol does not declare", () => {
    const extra = serverCommands().filter((name) => !protocolCommands().includes(name));
    expect(extra).toEqual([]);
  });

  it("every server tool name maps to a dispatched command", () => {
    const toolNames = [...serverSource.matchAll(/name: "(sketchforge_[a-z_]+)"/g)].map((match) => match[1]);
    const dispatched = [...serverSource.matchAll(/case "(sketchforge_[a-z_]+)":/g)].map((match) => match[1]);
    expect(toolNames.filter((name) => !dispatched.includes(name))).toEqual([]);
    expect(dispatched.filter((name) => !toolNames.includes(name))).toEqual([]);
  });
});
