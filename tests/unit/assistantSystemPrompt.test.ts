import { describe, expect, it } from "vitest";
import { buildAssistantSystemPrompt } from "@/lib/assistantSystemPrompt";

describe("buildAssistantSystemPrompt", () => {
  it("pins the assistant to the editor tab the dock belongs to", () => {
    const prompt = buildAssistantSystemPrompt({ editorNumber: 41234 });
    expect(prompt).toContain("editorNumber: 41234");
    expect(prompt).not.toContain("sketchforge_list_editors");
  });

  it("falls back to discovering the editor when no number is known", () => {
    const prompt = buildAssistantSystemPrompt({});
    expect(prompt).toContain("sketchforge_list_editors");
  });

  it("includes the scene summary when one is supplied", () => {
    const prompt = buildAssistantSystemPrompt({ editorNumber: 1, sceneContext: "Box A 20 x 20 x 10 mm" });
    expect(prompt).toContain("Box A 20 x 20 x 10 mm");
    expect(prompt).toContain("Current scene");
  });

  it("leaves the scene section out rather than printing an empty heading", () => {
    expect(buildAssistantSystemPrompt({ editorNumber: 1, sceneContext: "   " })).not.toContain("Current scene");
    expect(buildAssistantSystemPrompt()).not.toContain("Current scene");
  });

  it("tells the assistant it has scene tools only", () => {
    const prompt = buildAssistantSystemPrompt({ editorNumber: 1 });
    expect(prompt).toContain("sketchforge_* MCP tools");
    expect(prompt).toContain("no file, shell, or network tools");
  });
});
