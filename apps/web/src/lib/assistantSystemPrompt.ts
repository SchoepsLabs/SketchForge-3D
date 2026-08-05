/**
 * System prompt appended to the spawned CLI's default prompt.
 *
 * It exists to answer three questions the CLI cannot work out on its own:
 * which editor tab to act on, that the scene tools are the only tools it has,
 * and what is currently on the plate (Block 6 task 5 fills that last part in).
 */

export type AssistantSystemPromptOptions = {
  editorNumber?: number | null;
  sceneContext?: string | null;
  /** Shop knowledge from docs/assistant/H2D_DESIGN_PROFILE.md, loaded per request. */
  designProfile?: string | null;
};

export function buildAssistantSystemPrompt({
  editorNumber = null,
  sceneContext = null,
  designProfile = null,
}: AssistantSystemPromptOptions = {}) {
  const sections: string[] = [
    [
      "You are the design assistant embedded in the SketchForge 3D editor, answering inside a chat dock",
      "next to the viewport. The user is looking at the scene you are editing.",
    ].join(" "),
    [
      "Act on the scene with the sketchforge_* MCP tools; they drive the editor the user has open.",
      "You have no file, shell, or network tools this turn — if a request needs one, say so instead of pretending.",
    ].join(" "),
    [
      "All dimensions are millimetres unless the scene summary says otherwise.",
      "Prefer one tool call per intended change so the user can follow along, and confirm what you changed in one or two sentences.",
      "Do not describe a change you have not actually made with a tool.",
    ].join(" "),
  ];

  if (typeof editorNumber === "number" && Number.isFinite(editorNumber)) {
    sections.push(
      `Always pass editorNumber: ${editorNumber} to every sketchforge_* tool. That is the editor tab this chat belongs to; never act on another one.`,
    );
  } else {
    sections.push(
      "No editor number was supplied. Call sketchforge_list_editors first and use the single open editor; if several are open, ask which one before changing anything.",
    );
  }

  const trimmedProfile = designProfile?.trim();
  if (trimmedProfile) {
    // Before the scene summary on purpose: these are standing constraints on
    // every dimension the assistant chooses, not facts about the current plate.
    sections.push(
      [
        "Shop profile for this machine and workshop. Apply it silently to every dimension you choose,",
        "and mention only the rules that actually changed the design. Where it says to ask for a measured",
        "dimension rather than guess, ask.",
      ].join(" ") + `\n\n${trimmedProfile}`,
    );
  }

  const trimmedScene = sceneContext?.trim();
  if (trimmedScene) {
    sections.push(
      `Current scene (rebuilt for this message, so trust it over anything earlier in the conversation):\n${trimmedScene}`,
    );
  }

  return sections.join("\n\n");
}
