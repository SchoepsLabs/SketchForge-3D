"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildSceneDraft,
  decideDraftRestore,
  describeDraftAge,
  parseSceneDraft,
  serializeSceneDraft,
  SCENE_DRAFT_STORAGE_KEY,
  type SceneDraft,
} from "@/lib/sceneDraft";
import type { WorkplaneShape } from "@/types/sketchforge";

/**
 * Autosaves the working scene and offers it back after a crash or reload.
 *
 * Everything about *what* to save and *whether* to offer it lives in
 * lib/sceneDraft.ts; this component owns only the browser side — the debounce,
 * localStorage, and the notice. It renders nothing unless there is a draft worth
 * resuming.
 */

const SAVE_DEBOUNCE_MS = 1200;

export type SceneDraftGuardProps = {
  shapes: WorkplaneShape[];
  selectedIds: string[];
  projectId: string | null;
  projectName: string;
  /** True once the editor has loaded its initial scene; saving before that could persist an empty scene over a real draft. */
  ready: boolean;
  onRestore: (shapes: WorkplaneShape[], selectedIds: string[]) => void;
  onNotice?: (message: string) => void;
};

export function SceneDraftGuard({ shapes, selectedIds, projectId, projectName, ready, onRestore, onNotice }: SceneDraftGuardProps) {
  const [offer, setOffer] = useState<{ draft: SceneDraft; shapeCount: number } | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const checkedRef = useRef(false);
  const warnedTooLargeRef = useRef(false);
  const onRestoreRef = useRef(onRestore);
  const onNoticeRef = useRef(onNotice);

  onRestoreRef.current = onRestore;
  onNoticeRef.current = onNotice;

  // Look for a draft exactly once per mount, before autosave can overwrite it.
  useEffect(() => {
    if (!ready || checkedRef.current) return;
    checkedRef.current = true;
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(SCENE_DRAFT_STORAGE_KEY);
    } catch {
      return; // Storage blocked (private browsing): no draft, no crash.
    }
    const decision = decideDraftRestore({
      draft: parseSceneDraft(raw),
      currentShapes: shapes,
      projectId,
      now: Date.now(),
    });
    if (decision.offer) setOffer({ draft: decision.draft, shapeCount: decision.shapeCount });
    // Intentionally only on `ready`: this is a one-shot check of the scene as loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Autosave, debounced so a drag that commits many times writes once.
  useEffect(() => {
    if (!ready || !checkedRef.current) return;
    const timer = window.setTimeout(() => {
      const draft = buildSceneDraft({ shapes, selectedIds, projectId, projectName, now: Date.now() });
      const serialized = serializeSceneDraft(draft);
      if (!serialized.ok) {
        if (!warnedTooLargeRef.current) {
          warnedTooLargeRef.current = true;
          onNoticeRef.current?.("Scene is too large to autosave — save the project to keep it");
        }
        return;
      }
      warnedTooLargeRef.current = false;
      try {
        window.localStorage.setItem(SCENE_DRAFT_STORAGE_KEY, serialized.json);
      } catch {
        if (!warnedTooLargeRef.current) {
          warnedTooLargeRef.current = true;
          onNoticeRef.current?.("Autosave failed — browser storage is full or blocked");
        }
      }
    }, SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [projectId, projectName, ready, selectedIds, shapes]);

  const resume = useCallback(() => {
    if (!offer) return;
    onRestoreRef.current(offer.draft.shapes, offer.draft.selectedIds);
    setOffer(null);
  }, [offer]);

  const discard = useCallback(() => {
    try {
      window.localStorage.removeItem(SCENE_DRAFT_STORAGE_KEY);
    } catch {
      // Nothing to do; the draft simply stays until it goes stale.
    }
    setOffer(null);
    setDismissed(true);
  }, []);

  if (!offer || dismissed) return null;

  return (
    <div className="scene-draft-notice" role="status">
      <span className="scene-draft-text">
        Unsaved scene from {describeDraftAge(offer.draft.savedAt, Date.now())} ({offer.shapeCount} object
        {offer.shapeCount === 1 ? "" : "s"})
      </span>
      <div className="scene-draft-actions">
        <button type="button" className="scene-draft-button primary" onClick={resume}>
          Resume
        </button>
        <button type="button" className="scene-draft-button" onClick={discard}>
          Discard
        </button>
      </div>
    </div>
  );
}
