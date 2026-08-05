import { MOUSE } from "three";

export type MouseControlScheme = "sketchforge" | "tinkercad" | "fusion360" | "blender" | "solidworks" | "onshape";

export const MOUSE_CONTROL_SCHEME_STORAGE_KEY = "sketchForge.editor.mouseControlScheme";
export const DEFAULT_MOUSE_CONTROL_SCHEME: MouseControlScheme = "sketchforge";

export const MOUSE_CONTROL_SCHEME_OPTIONS: readonly { value: MouseControlScheme; label: string; summary: string }[] = [
  {
    value: "sketchforge",
    label: "SketchForge (default)",
    summary: "Right-drag orbit · middle-drag pan · Ctrl+left-drag pan · wheel zoom",
  },
  {
    value: "tinkercad",
    label: "Tinkercad",
    summary: "Right-drag orbit · Ctrl+left-drag orbit · Shift+right-drag or middle-drag pan · wheel zoom",
  },
  {
    value: "fusion360",
    label: "Fusion 360",
    summary: "Shift+middle-drag orbit · middle-drag pan · wheel zoom",
  },
  {
    value: "blender",
    label: "Blender",
    summary: "Middle-drag orbit · Shift+middle-drag pan · Ctrl+middle-drag zoom · wheel zoom",
  },
  {
    value: "solidworks",
    label: "SolidWorks",
    summary: "Middle-drag orbit · Ctrl+middle-drag pan · wheel zoom",
  },
  {
    value: "onshape",
    label: "Onshape",
    summary: "Right-drag orbit · Ctrl+right-drag or middle-drag pan · wheel zoom",
  },
];

export function normalizeMouseControlScheme(value: unknown): MouseControlScheme {
  return MOUSE_CONTROL_SCHEME_OPTIONS.some((option) => option.value === value)
    ? (value as MouseControlScheme)
    : DEFAULT_MOUSE_CONTROL_SCHEME;
}

export function readStoredMouseControlScheme(): MouseControlScheme {
  if (typeof window === "undefined") {
    return DEFAULT_MOUSE_CONTROL_SCHEME;
  }
  try {
    return normalizeMouseControlScheme(window.localStorage.getItem(MOUSE_CONTROL_SCHEME_STORAGE_KEY));
  } catch {
    return DEFAULT_MOUSE_CONTROL_SCHEME;
  }
}

let activeMouseControlScheme: MouseControlScheme | null = null;

export function getActiveMouseControlScheme(): MouseControlScheme {
  if (activeMouseControlScheme === null) {
    activeMouseControlScheme = readStoredMouseControlScheme();
  }
  return activeMouseControlScheme;
}

export function setActiveMouseControlScheme(scheme: MouseControlScheme) {
  activeMouseControlScheme = normalizeMouseControlScheme(scheme);
}

export function storeMouseControlScheme(scheme: MouseControlScheme) {
  setActiveMouseControlScheme(scheme);
  try {
    window.localStorage.setItem(MOUSE_CONTROL_SCHEME_STORAGE_KEY, scheme);
  } catch {
    // The preference still applies to this editor session when storage is unavailable.
  }
}

type MouseAction = MOUSE | null;

export type MouseButtonBindings = {
  LEFT: MouseAction;
  MIDDLE: MouseAction;
  RIGHT: MouseAction;
};

type PointerModifiers = Pick<PointerEvent, "button" | "ctrlKey" | "metaKey" | "shiftKey">;

/**
 * Resolve the OrbitControls mouse button bindings for a control scheme.
 * With no event this returns the scheme's resting bindings; with a pointerdown
 * event it applies the scheme's modifier combos for that press.
 * Plain left-drag is always reserved for selection/transform in every scheme.
 *
 * OrbitControls internally swaps ROTATE<->PAN on mousedown when Ctrl/Meta/Shift
 * is held, so when modifiers are down we pre-swap the pressed button's binding
 * to make OrbitControls' swap land on the action the scheme intends.
 */
export function resolveMouseButtons(scheme: MouseControlScheme, event?: PointerModifiers): MouseButtonBindings {
  const bindings = resolveIntendedMouseButtons(scheme, event);
  if (event && (event.ctrlKey || event.metaKey || event.shiftKey)) {
    const slot = event.button === 0 ? "LEFT" : event.button === 1 ? "MIDDLE" : event.button === 2 ? "RIGHT" : null;
    if (slot) {
      const action = bindings[slot];
      if (action === MOUSE.ROTATE) {
        bindings[slot] = MOUSE.PAN;
      } else if (action === MOUSE.PAN) {
        bindings[slot] = MOUSE.ROTATE;
      }
    }
  }
  return bindings;
}

function resolveIntendedMouseButtons(scheme: MouseControlScheme, event?: PointerModifiers): MouseButtonBindings {
  const ctrl = event ? event.ctrlKey || event.metaKey : false;
  const shift = event ? event.shiftKey : false;
  switch (scheme) {
    case "tinkercad":
      return {
        LEFT: event && event.button === 0 && ctrl ? MOUSE.ROTATE : null,
        MIDDLE: MOUSE.PAN,
        RIGHT: event && event.button === 2 && shift ? MOUSE.PAN : MOUSE.ROTATE,
      };
    case "fusion360":
      return {
        LEFT: null,
        MIDDLE: event && event.button === 1 && shift ? MOUSE.ROTATE : MOUSE.PAN,
        RIGHT: null,
      };
    case "blender":
      return {
        LEFT: null,
        MIDDLE: event && event.button === 1 && shift ? MOUSE.PAN : event && event.button === 1 && ctrl ? MOUSE.DOLLY : MOUSE.ROTATE,
        RIGHT: null,
      };
    case "solidworks":
      return {
        LEFT: null,
        MIDDLE: event && event.button === 1 && ctrl ? MOUSE.PAN : MOUSE.ROTATE,
        RIGHT: null,
      };
    case "onshape":
      return {
        LEFT: null,
        MIDDLE: MOUSE.PAN,
        RIGHT: event && event.button === 2 && ctrl ? MOUSE.PAN : MOUSE.ROTATE,
      };
    case "sketchforge":
    default:
      return {
        LEFT: event && event.button === 0 && ctrl ? MOUSE.PAN : null,
        MIDDLE: MOUSE.PAN,
        RIGHT: MOUSE.ROTATE,
      };
  }
}
