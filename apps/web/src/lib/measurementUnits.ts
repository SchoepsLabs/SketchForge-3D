import type { MeasurementAccuracy, WorkplaneWorkspaceSettings } from "@/types/sketchforge";

const MILLIMETERS_PER_INCH = 25.4;
const MILLIMETERS_PER_FOOT = 304.8;
const MILLIMETERS_PER_STUD = 8;

type WorkspaceScaleOption = {
  label: string;
  displayLabel: string;
  millimetersPerDisplayUnit: number;
};

const METRIC_SCALE_OPTIONS: WorkspaceScaleOption[] = [
  { label: "1:1 (millimeters)", displayLabel: "mm", millimetersPerDisplayUnit: 1 },
  { label: "1:10 (centimeters)", displayLabel: "cm", millimetersPerDisplayUnit: 10 },
  { label: "1:1000 (meters)", displayLabel: "m", millimetersPerDisplayUnit: 1000 },
];

const IMPERIAL_SCALE_OPTIONS: WorkspaceScaleOption[] = [
  { label: "1:1 (inches)", displayLabel: "in", millimetersPerDisplayUnit: MILLIMETERS_PER_INCH },
  { label: "1:1 (feet)", displayLabel: "ft", millimetersPerDisplayUnit: MILLIMETERS_PER_FOOT },
];

const BRICK_SCALE_OPTIONS: WorkspaceScaleOption[] = [
  { label: "1:1 (studs)", displayLabel: "stud", millimetersPerDisplayUnit: MILLIMETERS_PER_STUD },
];

export const WORKSPACE_UNIT_OPTIONS = ["Metric (Default)", "Imperial", "Bricks"] as const;

export type LengthDisplayUnit = {
  label: string;
  millimetersPerUnit: number;
};

function scaleEntriesForUnits(units: string) {
  if (units === "Imperial") return IMPERIAL_SCALE_OPTIONS;
  if (units === "Bricks") return BRICK_SCALE_OPTIONS;
  return METRIC_SCALE_OPTIONS;
}

export function scaleOptionsForUnits(units: string) {
  return scaleEntriesForUnits(units).map((option) => option.label);
}

export function defaultScaleForUnits(units: string) {
  return scaleEntriesForUnits(units)[0].label;
}

export function normalizeScaleForUnits(units: string, scale: string) {
  const options = scaleEntriesForUnits(units);
  const normalizedScale = units !== "Imperial" && units !== "Bricks" && scale === "1:100 (meters)" ? "1:1000 (meters)" : scale;
  return options.some((option) => option.label === normalizedScale) ? normalizedScale : options[0].label;
}

function scaleEntryForWorkspace(workspace: Pick<WorkplaneWorkspaceSettings, "units" | "scale">) {
  const options = scaleEntriesForUnits(workspace.units);
  const normalizedScale = normalizeScaleForUnits(workspace.units, workspace.scale);
  return options.find((option) => option.label === normalizedScale) ?? options[0];
}

export function lengthDisplayUnit(workspace: Pick<WorkplaneWorkspaceSettings, "units" | "scale">): LengthDisplayUnit {
  const scale = scaleEntryForWorkspace(workspace);
  return { label: scale.displayLabel, millimetersPerUnit: scale.millimetersPerDisplayUnit };
}

export function millimetersToDisplay(value: number, workspace: Pick<WorkplaneWorkspaceSettings, "units" | "scale">) {
  return value / lengthDisplayUnit(workspace).millimetersPerUnit;
}

export function displayToMillimeters(value: number, workspace: Pick<WorkplaneWorkspaceSettings, "units" | "scale">) {
  return value * lengthDisplayUnit(workspace).millimetersPerUnit;
}

export function displayStepFromMillimeters(step: number, workspace: Pick<WorkplaneWorkspaceSettings, "units" | "scale">) {
  return step / lengthDisplayUnit(workspace).millimetersPerUnit;
}

/**
 * Evaluates a small arithmetic expression so dimension fields accept things like
 * "20/3", "1.5+0.2" or "(40-4)/2" instead of forcing a calculator detour.
 *
 * Recursive descent over + - * / and parentheses, no eval. Anything that is not a
 * well-formed expression returns NaN so callers can fall back to
 * `parseMeasurementInput` and keep the old plain-number behaviour.
 */
export function parseMeasurementExpression(value: string): number {
  const src = value.trim().replace(/[\s ]/g, "");
  if (!src || !/^[0-9.,+\-*/()]+$/.test(src)) return Number.NaN;
  if (!/[+\-*/]/.test(src.slice(1))) return Number.NaN;

  let at = 0;
  const peek = () => src[at];

  const parseNumber = (): number => {
    const start = at;
    while (at < src.length && /[0-9.,]/.test(src[at])) at += 1;
    if (at === start) return Number.NaN;
    return parseMeasurementInput(src.slice(start, at));
  };

  const parseFactor = (): number => {
    if (peek() === "+") {
      at += 1;
      return parseFactor();
    }
    if (peek() === "-") {
      at += 1;
      return -parseFactor();
    }
    if (peek() === "(") {
      at += 1;
      const inner = parseSum();
      if (peek() !== ")") return Number.NaN;
      at += 1;
      return inner;
    }
    return parseNumber();
  };

  const parseProduct = (): number => {
    let acc = parseFactor();
    while (peek() === "*" || peek() === "/") {
      const op = src[at];
      at += 1;
      const rhs = parseFactor();
      if (!Number.isFinite(acc) || !Number.isFinite(rhs)) return Number.NaN;
      if (op === "/" && rhs === 0) return Number.NaN;
      acc = op === "*" ? acc * rhs : acc / rhs;
    }
    return acc;
  };

  function parseSum(): number {
    let acc = parseProduct();
    while (peek() === "+" || peek() === "-") {
      const op = src[at];
      at += 1;
      const rhs = parseProduct();
      if (!Number.isFinite(acc) || !Number.isFinite(rhs)) return Number.NaN;
      acc = op === "+" ? acc + rhs : acc - rhs;
    }
    return acc;
  }

  const result = parseSum();
  return at === src.length && Number.isFinite(result) ? result : Number.NaN;
}

export function parseMeasurementInput(value: string | number) {
  if (typeof value === "number") return Number.isFinite(value) ? value : Number.NaN;
  const compact = value.trim().replace(/[\s\u00a0]/g, "");
  if (!compact) return Number.NaN;

  const commaIndex = compact.lastIndexOf(",");
  const dotIndex = compact.lastIndexOf(".");
  let normalized = compact;
  if (commaIndex >= 0 && dotIndex >= 0) {
    normalized = commaIndex > dotIndex
      ? compact.replace(/\./g, "").replace(",", ".")
      : compact.replace(/,/g, "");
  } else if (commaIndex >= 0) {
    normalized = compact.replace(",", ".");
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function formatMeasurementNumber(value: number, accuracy: MeasurementAccuracy, _step?: number) {
  let decimals = accuracy;
  while (decimals < 6 && value !== 0 && Math.abs(value) < 0.5 * 10 ** -decimals) {
    decimals += 1;
  }
  const zeroThreshold = 0.5 * 10 ** -decimals;
  return (Math.abs(value) < zeroThreshold ? 0 : value).toFixed(decimals);
}
