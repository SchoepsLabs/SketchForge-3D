import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { createLocalId } from "@/lib/localIds";
import type { WorkplaneShape } from "@/types/sketchforge";

const stlLoader = new STLLoader();
const SUPPORTED_IMPORT_EXTENSIONS = new Set(["stl", "obj", "svg"]);

// Binary STL layout: 80-byte comment header, uint32 little-endian face count, then
// 50 bytes per facet (12 floats + a 2-byte attribute word).
const STL_BINARY_HEADER_BYTES = 84;
const STL_BINARY_FACE_BYTES = 50;
const STL_FACE_COUNT_OFFSET = 80;
const ASCII_SOLID_BYTES = [0x73, 0x6f, 0x6c, 0x69, 0x64]; // "solid"

/**
 * Upper bound on triangles allowed through to the mesh and, later, to CSG. Past this
 * the browser tab dies inside the kernel instead of reporting anything, so the import
 * is refused with a readable message first. 2M triangles is a ~100 MB binary STL —
 * far above any part this editor targets, and well above the 500k perf fixture.
 */
export const MAX_IMPORT_TRIANGLES = 2_000_000;

/**
 * Cross-product magnitude below which a triangle carries no surface. Duplicate vertices
 * give exactly 0; float noise on a real millimetre-scale mesh stays many orders of
 * magnitude above 1e-10, so this drops only triangles that would confuse the kernel.
 */
const DEGENERATE_CROSS_EPSILON = 1e-10;

/**
 * Every axis under 1 mm reads as a file authored in metres and displayed as millimetres —
 * the single most common reason an import arrives invisibly small.
 */
const METRE_AUTHORED_MAX_EXTENT_MM = 1;

function fileExtension(fileName: string) {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

function formatMm(value: number) {
  return String(Number(value.toFixed(4)));
}

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export type TriangleSoupIssues = {
  /** Triangles dropped because a coordinate was NaN or infinite. */
  nonFinite: number;
  /** Triangles dropped because they enclose no area. */
  degenerate: number;
  /** Trailing vertices that do not complete a triangle — the source is malformed. */
  danglingVertices: number;
};

export type SanitizedTriangleSoup = {
  positions: number[];
  normals?: number[];
  triangleCount: number;
  issues: TriangleSoupIssues;
};

/**
 * Drop triangles a mesh kernel cannot use. STLLoader happily returns NaN coordinates,
 * zero-area facets, and — when an ASCII facet is malformed — a vertex list that is not
 * a whole number of triangles, all of which surface much later as unexplained CSG
 * failures. Normals are kept index-aligned with the positions they belong to, and are
 * discarded wholesale if any survivor carries a non-finite normal so the caller falls
 * back to computed normals.
 *
 * Reopening a project re-imports the stored source bytes (skfProject `defaultSourceImporter`)
 * while the shape keeps its saved transform, so filtering must not move the bounding box.
 * Non-finite coordinates never could: they made the old box NaN and the import threw. Zero-area
 * facets sit on the surface in practice and leave the box alone; a stray one outside the box
 * is the one case where a project saved before this filter existed reopens slightly shifted —
 * accepted, because its extents were inflated by junk to begin with.
 */
export function sanitizeTriangleSoup(
  rawPositions: ArrayLike<number>,
  rawNormals?: ArrayLike<number>,
): SanitizedTriangleSoup {
  const alignedNormals =
    rawNormals && rawNormals.length === rawPositions.length ? rawNormals : undefined;
  const sourceTriangles = Math.floor(rawPositions.length / 9);
  const positions: number[] = [];
  const normals: number[] = [];
  const issues: TriangleSoupIssues = {
    nonFinite: 0,
    degenerate: 0,
    danglingVertices: Math.floor((rawPositions.length - sourceTriangles * 9) / 3),
  };
  let normalsUsable = alignedNormals !== undefined;

  for (let triangle = 0; triangle < sourceTriangles; triangle += 1) {
    const base = triangle * 9;

    let finite = true;
    for (let offset = 0; offset < 9; offset += 1) {
      if (!Number.isFinite(rawPositions[base + offset])) {
        finite = false;
        break;
      }
    }
    if (!finite) {
      issues.nonFinite += 1;
      continue;
    }

    const ax = rawPositions[base + 3] - rawPositions[base];
    const ay = rawPositions[base + 4] - rawPositions[base + 1];
    const az = rawPositions[base + 5] - rawPositions[base + 2];
    const bx = rawPositions[base + 6] - rawPositions[base];
    const by = rawPositions[base + 7] - rawPositions[base + 1];
    const bz = rawPositions[base + 8] - rawPositions[base + 2];
    const cx = ay * bz - az * by;
    const cy = az * bx - ax * bz;
    const cz = ax * by - ay * bx;
    if (Math.hypot(cx, cy, cz) <= DEGENERATE_CROSS_EPSILON) {
      issues.degenerate += 1;
      continue;
    }

    for (let offset = 0; offset < 9; offset += 1) {
      positions.push(rawPositions[base + offset]);
      if (alignedNormals) {
        const value = alignedNormals[base + offset];
        if (!Number.isFinite(value)) normalsUsable = false;
        normals.push(value);
      }
    }
  }

  return {
    positions,
    normals: normalsUsable && normals.length ? normals : undefined,
    triangleCount: positions.length / 9,
    issues,
  };
}

function describeIssues(issues: TriangleSoupIssues) {
  const parts: string[] = [];
  if (issues.nonFinite) parts.push(`${plural(issues.nonFinite, "triangle")} with invalid coordinates`);
  if (issues.degenerate) parts.push(`${plural(issues.degenerate, "zero-area triangle")}`);
  if (issues.danglingVertices) {
    const noun = issues.danglingVertices === 1 ? "stray vertex" : "stray vertices";
    parts.push(`${issues.danglingVertices} ${noun} that complete no triangle`);
  }
  if (!parts.length) return "";
  const last = parts.pop() as string;
  return parts.length ? `${parts.join(", ")} and ${last}` : last;
}

/**
 * Message shown when a file's extents look like metres rendered as millimetres.
 * Returns null when the size is plausible, so callers can pass the result straight
 * into a notice.
 */
export function importScaleWarning(size: { x: number; y: number; z: number }): string | null {
  const maxExtent = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(maxExtent) || maxExtent <= 0 || maxExtent >= METRE_AUTHORED_MAX_EXTENT_MM) {
    return null;
  }
  return `extents are only ${formatMm(size.x)} × ${formatMm(size.y)} × ${formatMm(size.z)} mm — this file looks authored in metres, so scale it by 1000 for ${formatMm(maxExtent * 1000)} mm`;
}

export type ImportOptions = {
  /** Called with non-fatal import problems, e.g. dropped triangles or metre-scale extents. */
  onWarning?: (message: string) => void;
};

export function importedShapeFromTriangleSoup(
  fileName: string,
  rawPositions: ArrayLike<number>,
  rawNormals: ArrayLike<number> | undefined,
  sourceFormat: NonNullable<WorkplaneShape["importedMesh"]>["sourceFormat"] = "stl",
  options: ImportOptions = {},
): WorkplaneShape {
  const label = sourceFormat.toUpperCase();
  const clean = sanitizeTriangleSoup(rawPositions, rawNormals);
  const summary = describeIssues(clean.issues);

  if (!clean.triangleCount) {
    throw new Error(
      summary
        ? `${label} file has no usable geometry: dropped ${summary}`
        : `${label} file has no triangles to import`,
    );
  }
  if (clean.triangleCount > MAX_IMPORT_TRIANGLES) {
    throw new Error(
      `${label} file is too large to import: ${clean.triangleCount.toLocaleString("en-US")} triangles exceeds the ${MAX_IMPORT_TRIANGLES.toLocaleString("en-US")} limit. Decimate the mesh and try again`,
    );
  }
  if (summary) {
    options.onWarning?.(`dropped ${summary}`);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(clean.positions, 3));
  if (clean.normals) {
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(clean.normals, 3));
  } else {
    geometry.computeVertexNormals();
  }
  geometry.computeBoundingBox();

  const box = geometry.boundingBox;
  if (!box) {
    throw new Error(`${label} has no readable geometry`);
  }

  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const maxDimension = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(maxDimension) || maxDimension <= 0) {
    throw new Error(`${label} geometry is empty`);
  }

  const scaleWarning = importScaleWarning(size);
  if (scaleWarning) {
    options.onWarning?.(scaleWarning);
  }

  const scale = 1;
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const positions: number[] = [];
  const normals: number[] = [];

  for (let i = 0; i < position.count; i += 1) {
    positions.push((position.getX(i) - center.x) * scale, (position.getY(i) - box.min.y) * scale, (position.getZ(i) - center.z) * scale);
    if (normal) {
      normals.push(normal.getX(i), normal.getY(i), normal.getZ(i));
    }
  }

  const width = Math.max(1, size.x * scale);
  const height = Math.max(1, size.y * scale);
  const depth = Math.max(1, size.z * scale);
  const triangleCount = clean.triangleCount;

  return {
    id: createLocalId("uploaded-mesh"),
    name: fileName.replace(/\.[^.]+$/, "") || `Imported ${sourceFormat.toUpperCase()}`,
    kind: "mesh",
    color: "#0098c7",
    x: 10,
    z: -10,
    size: Math.max(width, depth),
    width,
    depth,
    height,
    rotation: 0,
    rotationX: 0,
    rotationZ: 0,
    importedMesh: {
      positions,
      normals: normals.length ? normals : undefined,
      baseWidth: width,
      baseDepth: depth,
      baseHeight: height,
      triangleCount,
      sourceFormat,
    },
    locked: false,
    hidden: false,
  };
}

export function importExtensionSupported(fileName: string) {
  return SUPPORTED_IMPORT_EXTENSIONS.has(fileExtension(fileName));
}

function startsWithAsciiSolid(view: DataView) {
  // Mirrors STLLoader.isBinary: "solid" may sit behind up to 4 bytes of BOM.
  if (view.byteLength < ASCII_SOLID_BYTES.length + 4) return false;
  for (let offset = 0; offset < 5; offset += 1) {
    let matched = true;
    for (let i = 0; i < ASCII_SOLID_BYTES.length; i += 1) {
      if (view.getUint8(offset + i) !== ASCII_SOLID_BYTES[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

/**
 * STLLoader reads the binary face count at byte 80 with no bounds check, so a
 * truncated file, an oversized header, or any non-STL payload escapes as a bare
 * `RangeError: Offset is outside the bounds of the DataView`. Validate the framing
 * first so the user gets a sentence describing their file instead.
 */
function assertParsableStl(buffer: ArrayBuffer) {
  if (buffer.byteLength === 0) {
    throw new Error("STL file is empty");
  }
  const view = new DataView(buffer);

  // Order matches STLLoader.isBinary: an exact binary size match wins over the ASCII
  // "solid" prefix, because binary headers are free text and often start with "solid".
  if (buffer.byteLength >= STL_BINARY_HEADER_BYTES) {
    const declaredFaces = view.getUint32(STL_FACE_COUNT_OFFSET, true);
    const expectedBytes = STL_BINARY_HEADER_BYTES + declaredFaces * STL_BINARY_FACE_BYTES;
    if (expectedBytes === buffer.byteLength) {
      if (!declaredFaces) {
        throw new Error("STL file has no triangles to import");
      }
      if (declaredFaces > MAX_IMPORT_TRIANGLES) {
        throw new Error(
          `STL file is too large to import: ${declaredFaces.toLocaleString("en-US")} triangles exceeds the ${MAX_IMPORT_TRIANGLES.toLocaleString("en-US")} limit. Decimate the mesh and try again`,
        );
      }
      return;
    }

    if (startsWithAsciiSolid(view)) return;
    throw new Error(
      `STL file is truncated or not an STL: the binary header declares ${declaredFaces.toLocaleString("en-US")} triangles (${expectedBytes.toLocaleString("en-US")} bytes) but the file holds ${buffer.byteLength.toLocaleString("en-US")} bytes`,
    );
  }

  throw new Error(
    startsWithAsciiSolid(view)
      ? `STL file is truncated: ${buffer.byteLength} bytes is too short to hold a single facet`
      : `STL file is not readable: ${buffer.byteLength} bytes is too short for either the ASCII or the binary format`,
  );
}

export function importedShapeFromStl(
  fileName: string,
  buffer: ArrayBuffer,
  options: ImportOptions = {},
): WorkplaneShape {
  assertParsableStl(buffer);

  let rawGeometry: THREE.BufferGeometry;
  try {
    rawGeometry = stlLoader.parse(buffer);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read STL file: ${reason}`);
  }

  const geometry = rawGeometry.index ? rawGeometry.toNonIndexed() : rawGeometry.clone();
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  if (!position) {
    throw new Error("STL file has no triangles to import");
  }
  const rawPositions: number[] = [];
  const rawNormals: number[] = [];

  for (let i = 0; i < position.count; i += 1) {
    rawPositions.push(position.getX(i), position.getY(i), position.getZ(i));
    if (normal) {
      rawNormals.push(normal.getX(i), normal.getY(i), normal.getZ(i));
    }
  }

  return importedShapeFromTriangleSoup(
    fileName,
    rawPositions,
    rawNormals.length ? rawNormals : undefined,
    "stl",
    options,
  );
}
