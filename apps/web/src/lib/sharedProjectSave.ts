/**
 * Client-side rules for saving a `.skf` into the mounted shared parts library.
 *
 * The server route already writes atomically and guards with revisions; what was
 * missing is the caller's half — telling "a part with that name already exists"
 * apart from "the file changed since you opened it", because only the first one
 * is a question worth asking the user ("overwrite?") and the second is a genuine
 * conflict they must resolve by reloading.
 */

export type SharedSaveMode =
  /** First save under this name: fail if anything is already there. */
  | { kind: "create" }
  /** Save back over a known revision: fail if it moved under us. */
  | { kind: "replace"; revision: string };

export type SharedSaveFailureKind =
  | "name-taken"
  | "stale-revision"
  | "missing"
  | "disabled"
  | "too-large"
  | "locked"
  | "other";

export type SharedSaveFailure = {
  kind: SharedSaveFailureKind;
  message: string;
  currentRevision: string | null;
  /** True when re-sending with mode `replace` is the natural next step. */
  overwritable: boolean;
};

export function sharedProjectFileName(exportName: string, fallback = "Untitled project") {
  const stem = exportName.replace(/\.skf$/i, "").trim();
  return `${stem || fallback}.skf`;
}

export function sharedSaveHeaders(mode: SharedSaveMode): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/vnd.sketchforge.project+zip" };
  if (mode.kind === "replace") headers["If-Match"] = `"${mode.revision}"`;
  else headers["If-None-Match"] = "*";
  return headers;
}

const DISABLED_HINT =
  "Shared storage is off: set SKETCHFORGE_SHARED_PROJECTS_DIR in deploy/docker/.env (or the dev environment) and restart the server.";

export function classifySharedSaveFailure(
  status: number,
  payload: { error?: string; reason?: string; currentRevision?: string | null } | null,
): SharedSaveFailure {
  const currentRevision = typeof payload?.currentRevision === "string" ? payload.currentRevision : null;
  const serverMessage = typeof payload?.error === "string" && payload.error.trim() ? payload.error.trim() : null;

  if (status === 404) {
    return { kind: "disabled", message: DISABLED_HINT, currentRevision: null, overwritable: false };
  }
  if (status === 413) {
    return { kind: "too-large", message: serverMessage ?? "This project is too large for the shared library.", currentRevision: null, overwritable: false };
  }
  if (status === 409) {
    // The route names the case; older builds only sent prose, so fall back to it.
    if (payload?.reason === "name-taken") {
      return {
        kind: "name-taken",
        message: serverMessage ?? "A shared part already uses that name.",
        currentRevision,
        overwritable: Boolean(currentRevision),
      };
    }
    if (payload?.reason === "locked" || /being saved by someone else/i.test(serverMessage ?? "")) {
      return { kind: "locked", message: serverMessage ?? "That shared part is being saved right now — try again in a moment.", currentRevision, overwritable: false };
    }
    if (payload?.reason === "missing" || /no longer exists/i.test(serverMessage ?? "")) {
      return { kind: "missing", message: serverMessage ?? "That shared part no longer exists. Save it under a new name.", currentRevision: null, overwritable: false };
    }
    return {
      kind: "stale-revision",
      message: serverMessage ?? "The shared part changed after you opened it. Reload it or save under a different name.",
      currentRevision,
      overwritable: false,
    };
  }
  return { kind: "other", message: serverMessage ?? `Could not save the shared project (HTTP ${status}).`, currentRevision, overwritable: false };
}

/** The question the confirm bar asks. Kept here so the wording is testable. */
export function overwritePrompt(fileName: string) {
  return `${fileName.replace(/\.skf$/i, "")} already exists in the shared library. Overwrite it?`;
}

/**
 * Carries the classified failure back to the editor, which decides whether to
 * offer an overwrite. A plain Error would flatten the distinction back to prose.
 */
export class SharedProjectSaveError extends Error {
  readonly failure: SharedSaveFailure;
  readonly fileName: string;

  constructor(failure: SharedSaveFailure, fileName: string) {
    super(failure.message);
    this.name = "SharedProjectSaveError";
    this.failure = failure;
    this.fileName = fileName;
  }
}
