import { describe, expect, it } from "vitest";
import { importedShapeFromObj, readObjSource } from "@/lib/objImport";

function objBuffer(text: string) {
  const bytes = new TextEncoder().encode(text);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function importObj(fileName: string, text: string, onWarning?: (message: string) => void) {
  return importedShapeFromObj(fileName, objBuffer(text), onWarning ? { onWarning } : {});
}

function collectWarnings(run: (onWarning: (message: string) => void) => void) {
  const warnings: string[] = [];
  run((message) => warnings.push(message));
  return warnings;
}

/** 20 mm cube spanning 0..20 on every axis, written as quads the way Blender exports. */
const CUBE_OBJ = [
  "# cube",
  "v 0 0 0",
  "v 20 0 0",
  "v 20 20 0",
  "v 0 20 0",
  "v 0 0 20",
  "v 20 0 20",
  "v 20 20 20",
  "v 0 20 20",
  "f 1 2 3 4",
  "f 5 6 7 8",
  "f 1 2 6 5",
  "f 3 4 8 7",
  "f 2 3 7 6",
  "f 1 4 8 5",
  "",
].join("\n");

/** Shaped exactly like the editor's own `toObj` output, including the running vertex offset. */
const SKETCHFORGE_EXPORT_OBJ = [
  "# SketchForge OBJ export",
  "o plate",
  "v 0 0 0",
  "v 20 0 0",
  "v 20 0 10",
  "v 0 0 10",
  "f 1 2 3",
  "f 1 3 4",
  "o riser",
  "v 0 6 0",
  "v 20 6 0",
  "v 20 6 10",
  "v 0 6 10",
  "f 5 6 7",
  "f 5 7 8",
  "",
].join("\n");

const TRIANGLE_OBJ = "v 0 0 0\nv 20 0 0\nv 0 0 10\nf 1 2 3\n";

describe("importedShapeFromObj — valid input", () => {
  it("imports a cube fixture with the right triangle count, extents, and name", () => {
    const shape = importObj("cube.obj", CUBE_OBJ);
    expect(shape.name).toBe("cube");
    expect(shape.importedMesh?.sourceFormat).toBe("obj");
    // Six quads fan-triangulate into twelve triangles.
    expect(shape.importedMesh?.triangleCount).toBe(12);
    expect(shape.importedMesh?.baseWidth).toBeCloseTo(20, 6);
    expect(shape.importedMesh?.baseHeight).toBeCloseTo(20, 6);
    expect(shape.importedMesh?.baseDepth).toBeCloseTo(20, 6);
  });

  it("closes the round trip on the editor's own OBJ export, offsets and all", () => {
    // toObj (SketchForgeEditor) restarts vertex numbering per `o` block by adding a running
    // offset, so the second object's faces reference indices past the first object's vertices.
    const shape = importObj("design.obj", SKETCHFORGE_EXPORT_OBJ);
    expect(shape.importedMesh?.triangleCount).toBe(4);
    expect(shape.importedMesh?.baseWidth).toBeCloseTo(20, 6);
    expect(shape.importedMesh?.baseHeight).toBeCloseTo(6, 6);
    expect(shape.importedMesh?.baseDepth).toBeCloseTo(10, 6);
  });

  it("fan-triangulates polygons larger than a quad", () => {
    const pentagon = "v 0 0 0\nv 10 0 0\nv 12 0 6\nv 5 0 12\nv -2 0 6\nf 1 2 3 4 5\n";
    expect(importObj("pentagon.obj", pentagon).importedMesh?.triangleCount).toBe(3);
  });

  it("resolves negative face indices to the same geometry as positive ones", () => {
    const negative = importObj("negative.obj", "v 0 0 0\nv 20 0 0\nv 0 0 10\nf -3 -2 -1\n");
    const positive = importObj("positive.obj", TRIANGLE_OBJ);
    expect(negative.importedMesh?.positions).toEqual(positive.importedMesh?.positions);
  });

  it("accepts texture and normal references in face vertices", () => {
    const textured = "v 0 0 0\nv 20 0 0\nv 0 0 10\nvt 0 0\nvt 1 0\nvt 0 1\nvn 0 1 0\nf 1/1/1 2/2/1 3/3/1\n";
    const normalsOnly = "v 0 0 0\nv 20 0 0\nv 0 0 10\nvn 0 1 0\nvn 0 1 0\nvn 0 1 0\nf 1//1 2//2 3//3\n";
    expect(importObj("textured.obj", textured).importedMesh?.triangleCount).toBe(1);
    expect(importObj("normals.obj", normalsOnly).importedMesh?.triangleCount).toBe(1);
  });

  it("reads CRLF line endings, a byte order mark, and per-vertex colours", () => {
    const messy = "﻿# comment\r\nv 0 0 0 1 0 0\r\nv 20 0 0 0 1 0\r\nv 0 0 10 0 0 1\r\nf 1 2 3\r\n";
    const shape = importObj("messy.obj", messy);
    expect(shape.importedMesh?.triangleCount).toBe(1);
    expect(shape.importedMesh?.baseWidth).toBeCloseTo(20, 6);
  });

  it("joins faces continued across lines with a trailing backslash", () => {
    // OBJLoader folds CRLF and joins `\`-continued lines before it splits, so the reader
    // has to fold them too or it validates a different set of lines than the parser reads.
    const hexagon = "v 0 0 0\nv 10 0 0\nv 12 0 6\nv 5 0 12\nv -2 0 6\nv -4 0 2\n";
    const continued = importObj("hexagon.obj", `${hexagon}f 1 2 3 \\\n  4 5 6\n`);
    const inline = importObj("hexagon.obj", `${hexagon}f 1 2 3 4 5 6\n`);
    expect(continued.importedMesh?.triangleCount).toBe(4);
    expect(continued.importedMesh?.positions).toEqual(inline.importedMesh?.positions);
  });

  it("keeps the mesh when the file also carries line and point elements", () => {
    // OBJLoader tracks one geometry type per object and the last element seen wins, so an
    // `l` next to faces returns the whole object as LineSegments and the mesh vanishes.
    // Stripping those lines first keeps the faces and keeps the stray vertex — which would
    // inflate the bounding box the shape is sized and centred on — out of the soup.
    const withStrayLine = `${CUBE_OBJ}v 500 500 500\nl 1 9\np 9\n`;
    const shape = importObj("annotated.obj", withStrayLine);
    expect(shape.importedMesh?.triangleCount).toBe(12);
    expect(shape.importedMesh?.baseWidth).toBeCloseTo(20, 6);
    expect(shape.importedMesh?.positions).toEqual(importObj("cube.obj", CUBE_OBJ).importedMesh?.positions);
  });
});

describe("importedShapeFromObj — hardening", () => {
  it("rejects an empty file", () => {
    expect(() => importObj("empty.obj", "")).toThrowError(/OBJ file is empty/);
    expect(() => importObj("blank.obj", "\n\n   \n")).toThrowError(/OBJ file is empty/);
  });

  it("rejects a payload that holds no vertices instead of warning once per line", () => {
    expect(() => importObj("page.obj", "<!doctype html><html><body>nope</body></html>")).toThrowError(
      /no vertex \(v\) lines/,
    );
  });

  it("names the offending line when a face index is out of range", () => {
    // A truncated OBJ manifests exactly this way: OBJLoader turns the missing vertex into
    // NaN, which would otherwise reach the user as the sanitizer's "invalid coordinates".
    expect(() => importObj("truncated.obj", "v 0 0 0\nv 20 0 0\nv 0 0 10\nf 1 2 9\n")).toThrowError(
      /face on line 4 references vertex 9 but only 3 vertices are defined/,
    );
    expect(() => importObj("truncated.obj", "v 0 0 0\nf -2 -1 1\n")).toThrowError(
      /face on line 2 references vertex -2 but only 1 vertex is defined/,
    );
  });

  it("range-checks indices that sit past a line continuation", () => {
    // Reading the raw text would stop validating at the backslash and let the tail through.
    expect(() => importObj("truncated.obj", "v 0 0 0\nv 20 0 0\nv 0 0 10\nf 1 2 \\\n 9\n")).toThrowError(
      /references vertex 9 but only 3 vertices are defined/,
    );
  });

  it("keeps the mesh when a line element is continued across rows", () => {
    const withContinuedLine = `${TRIANGLE_OBJ}v 500 500 500\nl 1 2 \\\n 4\n`;
    const shape = importObj("annotated.obj", withContinuedLine);
    expect(shape.importedMesh?.triangleCount).toBe(1);
    expect(shape.importedMesh?.positions).toEqual(importObj("clean.obj", TRIANGLE_OBJ).importedMesh?.positions);
  });

  it("reports a file that carries only line or point geometry", () => {
    expect(() => importObj("outline.obj", "v 0 0 0\nv 20 0 0\nl 1 2\n")).toThrowError(
      /only line or point geometry/,
    );
  });

  it("reports faces that name fewer than three vertices", () => {
    expect(() => importObj("edges.obj", "v 0 0 0\nv 20 0 0\nf 1 2\n")).toThrowError(
      /no usable faces/,
    );
  });

  it("drops zero-area faces and warns, without moving the surviving geometry", () => {
    const withDegenerate = `${TRIANGLE_OBJ}f 1 1 1\n`;
    let shape;
    const warnings = collectWarnings((onWarning) => {
      shape = importObj("degenerate.obj", withDegenerate, onWarning);
    });
    expect(shape?.importedMesh?.triangleCount).toBe(1);
    expect(warnings.join(" ")).toMatch(/1 zero-area triangle/);
    expect(shape?.importedMesh?.positions).toEqual(importObj("clean.obj", TRIANGLE_OBJ).importedMesh?.positions);
  });

  it("warns when the extents look authored in metres", () => {
    // Blender's default export unit is metres, so this is the likeliest OBJ warning of all.
    const metres = "v 0 0 0\nv 0.02 0 0\nv 0 0 0.01\nf 1 2 3\n";
    const warnings = collectWarnings((onWarning) => {
      importObj("metres.obj", metres, onWarning);
    });
    expect(warnings.join(" ")).toMatch(/looks authored in metres/);
  });
});

describe("readObjSource", () => {
  it("counts vertices, faces, and non-face elements", () => {
    expect(readObjSource(CUBE_OBJ).contents).toEqual({ vertices: 8, faces: 6, nonFaceElements: 0 });
    expect(readObjSource("v 0 0 0\nv 1 0 0\nv 0 0 1\nf 1 2 3\nl 1 2\np 3\n").contents).toEqual({
      vertices: 3,
      faces: 1,
      nonFaceElements: 2,
    });
  });

  it("blanks only the line and point elements, leaving vertex numbering intact", () => {
    const source = readObjSource("v 0 0 0\nv 1 0 0\nv 0 0 1\nl 1 2\nf 1 2 3\np 3\n");
    expect(source.faceText).toBe("v 0 0 0\nv 1 0 0\nv 0 0 1\n\nf 1 2 3\n\n");
  });

  it("returns the text untouched when there is nothing to strip or fold", () => {
    expect(readObjSource(CUBE_OBJ).faceText).toBe(CUBE_OBJ);
  });

  it("folds CRLF and line continuations into the text OBJLoader will read", () => {
    expect(readObjSource("v 0 0 0\r\nv 1 0 0 \\\n 0\r\nv 0 0 1\r\nf 1 2 3\r\n").faceText)
      .toBe("v 0 0 0\nv 1 0 0  0\nv 0 0 1\nf 1 2 3\n");
  });

  it("ignores comments and unknown keywords", () => {
    const withExtras = `mtllib parts.mtl\nusemtl red\ns 1\ng shell\n${TRIANGLE_OBJ}s off\n`;
    expect(readObjSource(withExtras).contents.faces).toBe(1);
  });
});
