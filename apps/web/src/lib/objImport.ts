import * as THREE from "three";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { importedShapeFromTriangleSoup, type ImportOptions } from "@/lib/stlImport";
import type { WorkplaneShape } from "@/types/sketchforge";

const objLoader = new OBJLoader();

/**
 * Counts gathered while validating the text, used to explain what a file holds
 * when it holds no faces.
 */
type ObjContents = {
  vertices: number;
  faces: number;
  /** `l` polylines and `p` point sets — geometry OBJLoader returns as non-Mesh children. */
  nonFaceElements: number;
};

/**
 * Mirrors what OBJLoader.parse does to the text before it splits on newlines: CRLF is
 * folded and a trailing `\` joins its line with the next one. Validating the raw text
 * instead would mean checking a different set of lines than the parser reads — a face
 * continued across two lines would leave everything after the `\` unvalidated, which is
 * exactly the truncation case the range check exists for. The `indexOf` guards keep a
 * large file from being copied when there is nothing to fold.
 */
function normalizeObjText(rawText: string) {
  let text = rawText.charCodeAt(0) === 0xfeff ? rawText.slice(1) : rawText;
  if (text.indexOf("\r\n") !== -1) text = text.replace(/\r\n/g, "\n");
  if (text.indexOf("\\\n") !== -1) text = text.replace(/\\\n/g, "");
  return text;
}

/**
 * `f` vertex references are `v`, `v/vt`, `v//vn`, or `v/vt/vn`; only the first
 * component addresses a position. Positive indices are 1-based into the vertices
 * declared *so far* and negative indices count back from the most recent one,
 * which is exactly how OBJLoader resolves them — anything outside that range
 * silently becomes a NaN vertex.
 */
function positionIndexOf(reference: string) {
  const raw = reference.split("/")[0];
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

export type ObjSource = {
  contents: ObjContents;
  /**
   * The normalized text with its `l` and `p` element lines removed, and the string that
   * must be handed to OBJLoader. It tracks one geometry type per object and the last
   * element seen wins, so a single `l` anywhere turns that object — faces and all — into
   * LineSegments and the mesh disappears. Vertex lines are untouched, so every face index
   * still resolves to the same vertex.
   */
  faceText: string;
};

/**
 * OBJLoader never throws: garbage produces one `console.warn` per unreadable line
 * and an empty group, and an out-of-range face index produces NaN vertices that
 * would otherwise reach the user as the sanitizer's vague "invalid coordinates".
 * Reading the text first turns all three into a sentence about their file, keeps a
 * mis-named binary from warning once per line, and drops the non-face elements that
 * would otherwise cost us the whole mesh.
 */
export function readObjSource(rawText: string): ObjSource {
  const contents: ObjContents = { vertices: 0, faces: 0, nonFaceElements: 0 };
  const text = normalizeObjText(rawText);
  if (!text.trim()) {
    throw new Error("OBJ file is empty");
  }

  const rows = text.split("\n");
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index].trim();
    if (!row || row.startsWith("#")) continue;
    const parts = row.split(/\s+/);
    const keyword = parts[0];

    if (keyword === "v") {
      contents.vertices += 1;
      continue;
    }
    if (keyword === "l" || keyword === "p") {
      contents.nonFaceElements += 1;
      rows[index] = "";
      continue;
    }
    if (keyword !== "f") continue;

    contents.faces += 1;
    for (let part = 1; part < parts.length; part += 1) {
      const reference = positionIndexOf(parts[part]);
      if (reference === null) continue;
      const resolved = reference < 0 ? contents.vertices + reference + 1 : reference;
      if (resolved >= 1 && resolved <= contents.vertices) continue;
      throw new Error(
        `OBJ file is truncated or malformed: the face on line ${index + 1} references vertex ${parts[part]} but only ${contents.vertices.toLocaleString("en-US")} ${contents.vertices === 1 ? "vertex is" : "vertices are"} defined above it`,
      );
    }
  }

  if (!contents.vertices) {
    throw new Error("OBJ file is not readable: it holds no vertex (v) lines");
  }
  if (!contents.faces) {
    throw new Error(
      contents.nonFaceElements
        ? "OBJ file has no faces to import: it holds only line or point geometry"
        : "OBJ file has no faces to import",
    );
  }
  return { contents, faceText: contents.nonFaceElements ? rows.join("\n") : text };
}

/**
 * With `l` and `p` stripped, OBJLoader returns Meshes for everything except a
 * malformed `f` naming fewer than three vertices, which still comes back as Points.
 * Only Meshes carry triangles, so anything else is skipped rather than folded into
 * the soup, where its vertices would drag the bounding box — and therefore the
 * imported shape's size — out with it.
 */
function triangleSoupFromObjGroup(group: THREE.Group, contents: ObjContents) {
  const positions: number[] = [];
  const normals: number[] = [];
  let meshCount = 0;
  let normalsPresent = true;

  group.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
    const position = geometry.getAttribute("position");
    if (!position) return;
    meshCount += 1;

    const normal = geometry.getAttribute("normal");
    if (!normal) normalsPresent = false;
    for (let vertex = 0; vertex < position.count; vertex += 1) {
      positions.push(position.getX(vertex), position.getY(vertex), position.getZ(vertex));
      if (normal) {
        normals.push(normal.getX(vertex), normal.getY(vertex), normal.getZ(vertex));
      }
    }
  });

  if (!meshCount || !positions.length) {
    throw new Error(
      contents.faces
        ? `OBJ file has no usable faces: its ${contents.faces.toLocaleString("en-US")} face ${contents.faces === 1 ? "line names" : "lines name"} fewer than three vertices each`
        : "OBJ file has no faces to import",
    );
  }

  return { positions, normals: normalsPresent && normals.length ? normals : undefined };
}

export function importedShapeFromObj(
  fileName: string,
  buffer: ArrayBuffer,
  options: ImportOptions = {},
): WorkplaneShape {
  const { contents, faceText } = readObjSource(new TextDecoder().decode(buffer));

  let group: THREE.Group;
  try {
    group = objLoader.parse(faceText);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read OBJ file: ${reason}`);
  }

  const { positions, normals } = triangleSoupFromObjGroup(group, contents);
  return importedShapeFromTriangleSoup(fileName, positions, normals, "obj", options);
}
