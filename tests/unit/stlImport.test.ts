import { describe, expect, it } from "vitest";
import {
  MAX_IMPORT_TRIANGLES,
  importScaleWarning,
  importedShapeFromStl,
  sanitizeTriangleSoup,
} from "@/lib/stlImport";

type Triangle = [number, number, number][];

const BINARY_HEADER_BYTES = 84;
const BINARY_FACE_BYTES = 50;

function binaryStl(triangles: Triangle[], { declaredFaces = triangles.length, truncateTo = -1 } = {}) {
  const buffer = new ArrayBuffer(BINARY_HEADER_BYTES + triangles.length * BINARY_FACE_BYTES);
  const view = new DataView(buffer);
  view.setUint32(80, declaredFaces, true);
  triangles.forEach((triangle, index) => {
    const base = BINARY_HEADER_BYTES + index * BINARY_FACE_BYTES;
    view.setFloat32(base, 0, true);
    view.setFloat32(base + 4, 1, true);
    view.setFloat32(base + 8, 0, true);
    triangle.forEach(([x, y, z], vertex) => {
      view.setFloat32(base + 12 + vertex * 12, x, true);
      view.setFloat32(base + 16 + vertex * 12, y, true);
      view.setFloat32(base + 20 + vertex * 12, z, true);
    });
  });
  return truncateTo < 0 ? buffer : buffer.slice(0, truncateTo);
}

function asciiStl(body: string) {
  const bytes = new TextEncoder().encode(body);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** Two triangles spanning 20 × 0 × 10 mm, both with real area. */
const FLAT_PAIR: Triangle[] = [
  [
    [0, 0, 0],
    [20, 0, 0],
    [0, 0, 10],
  ],
  [
    [20, 0, 0],
    [20, 0, 10],
    [0, 0, 10],
  ],
];

const ASCII_FACET = (vertices: string[]) =>
  `facet normal 0 1 0\n outer loop\n${vertices.map((v) => `  vertex ${v}\n`).join("")} endloop\nendfacet\n`;

const ASCII_GOOD_FACET = ASCII_FACET(["0 0 0", "20 0 0", "0 0 10"]);
const ASCII_NAN_FACET = ASCII_FACET(["0 0 0", "NaN 0 0", "0 0 10"]);

function collectWarnings(run: (onWarning: (message: string) => void) => void) {
  const warnings: string[] = [];
  run((message) => warnings.push(message));
  return warnings;
}

describe("importedShapeFromStl — valid input", () => {
  it("imports a binary STL and reports the triangle count and extents", () => {
    const shape = importedShapeFromStl("plate.stl", binaryStl(FLAT_PAIR));
    expect(shape.name).toBe("plate");
    expect(shape.importedMesh?.triangleCount).toBe(2);
    expect(shape.importedMesh?.sourceFormat).toBe("stl");
    expect(shape.importedMesh?.baseWidth).toBeCloseTo(20, 6);
    expect(shape.importedMesh?.baseDepth).toBeCloseTo(10, 6);
    // A flat sheet has zero height; the shape keeps the existing 1 mm floor.
    expect(shape.importedMesh?.baseHeight).toBe(1);
  });

  it("imports an ASCII STL", () => {
    const shape = importedShapeFromStl("ascii.stl", asciiStl(`solid p\n${ASCII_GOOD_FACET}endsolid p\n`));
    expect(shape.importedMesh?.triangleCount).toBe(1);
  });

  it("emits no warnings for a clean millimetre-scale file", () => {
    const warnings = collectWarnings((onWarning) => {
      importedShapeFromStl("plate.stl", binaryStl(FLAT_PAIR), { onWarning });
    });
    expect(warnings).toEqual([]);
  });
});

describe("importedShapeFromStl — truncated and malformed binaries", () => {
  it("reports a truncated binary instead of letting the loader throw a RangeError", () => {
    const truncated = binaryStl(FLAT_PAIR, { declaredFaces: 100, truncateTo: 120 });
    expect(() => importedShapeFromStl("cut.stl", truncated)).toThrowError(/truncated/i);
    expect(() => importedShapeFromStl("cut.stl", truncated)).toThrowError(/100 triangles/);
  });

  it("reports a header that declares far more triangles than the file holds", () => {
    const buffer = new ArrayBuffer(120);
    new DataView(buffer).setUint32(80, 40_000_000, true);
    expect(() => importedShapeFromStl("bogus.stl", buffer)).toThrowError(/40,000,000 triangles/);
  });

  it("refuses a binary header above the triangle limit before parsing", () => {
    const declaredFaces = MAX_IMPORT_TRIANGLES + 1;
    const buffer = new ArrayBuffer(BINARY_HEADER_BYTES + declaredFaces * BINARY_FACE_BYTES);
    new DataView(buffer).setUint32(80, declaredFaces, true);
    expect(() => importedShapeFromStl("huge.stl", buffer)).toThrowError(/too large to import/);
  });

  it("rejects a binary header that declares zero triangles", () => {
    const buffer = new ArrayBuffer(BINARY_HEADER_BYTES);
    expect(() => importedShapeFromStl("empty.stl", buffer)).toThrowError(/no triangles/i);
  });

  it("rejects an empty file and files too short for either format", () => {
    expect(() => importedShapeFromStl("nothing.stl", new ArrayBuffer(0))).toThrowError(/empty/i);
    expect(() => importedShapeFromStl("tiny.stl", asciiStl("not an stl at all"))).toThrowError(/too short/i);
  });

  it("never lets a raw loader exception escape", () => {
    const malformed = [
      new ArrayBuffer(0),
      new ArrayBuffer(40),
      asciiStl("hello world, definitely not a mesh"),
      binaryStl(FLAT_PAIR, { declaredFaces: 100, truncateTo: 200 }),
      binaryStl(FLAT_PAIR, { truncateTo: BINARY_HEADER_BYTES + 10 }),
      asciiStl("solid broken\nfacet normal\nendsolid broken\n"),
    ];
    for (const buffer of malformed) {
      let thrown: unknown;
      try {
        importedShapeFromStl("suspect.stl", buffer);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(Error);
      const message = (thrown as Error).message;
      expect(message).toMatch(/STL/);
      expect(message).not.toMatch(/DataView|undefined|\[object/);
    }
  });
});

describe("importedShapeFromStl — NaN and degenerate triangles", () => {
  it("drops NaN triangles from a binary STL and warns", () => {
    const nan: Triangle = [
      [Number.NaN, 0, 0],
      [10, 0, 0],
      [0, 0, 10],
    ];
    let shape;
    const warnings = collectWarnings((onWarning) => {
      shape = importedShapeFromStl("mixed.stl", binaryStl([...FLAT_PAIR, nan]), { onWarning });
    });
    expect(shape?.importedMesh?.triangleCount).toBe(2);
    expect(warnings.join(" ")).toMatch(/1 triangle with invalid coordinates/);
  });

  it("drops zero-area triangles and keeps the rest", () => {
    const flat: Triangle = [
      [5, 0, 5],
      [5, 0, 5],
      [5, 0, 5],
    ];
    const collinear: Triangle = [
      [0, 0, 0],
      [10, 0, 0],
      [20, 0, 0],
    ];
    let shape;
    const warnings = collectWarnings((onWarning) => {
      shape = importedShapeFromStl("degenerate.stl", binaryStl([...FLAT_PAIR, flat, collinear]), { onWarning });
    });
    expect(shape?.importedMesh?.triangleCount).toBe(2);
    expect(warnings.join(" ")).toMatch(/2 zero-area triangles/);
  });

  it("fails readably when every triangle is unusable", () => {
    const nan: Triangle = [
      [Number.NaN, 0, 0],
      [Number.POSITIVE_INFINITY, 0, 0],
      [0, 0, 10],
    ];
    const flat: Triangle = [
      [1, 1, 1],
      [1, 1, 1],
      [1, 1, 1],
    ];
    expect(() => importedShapeFromStl("junk.stl", binaryStl([nan, flat]))).toThrowError(
      /no usable geometry: dropped 1 triangle with invalid coordinates and 1 zero-area triangle/,
    );
  });

  it("survives an ASCII facet whose NaN vertex desynchronises the vertex list", () => {
    // STLLoader drops only the unparseable vertex, leaving a vertex count that is not a
    // whole number of triangles. Keeping the aligned prefix beats importing garbage.
    const buffer = asciiStl(`solid p\n${ASCII_GOOD_FACET}${ASCII_NAN_FACET}endsolid p\n`);
    let shape;
    const warnings = collectWarnings((onWarning) => {
      shape = importedShapeFromStl("nan.stl", buffer, { onWarning });
    });
    expect(shape?.importedMesh?.triangleCount).toBe(1);
    expect(warnings.join(" ")).toMatch(/2 stray vertices that complete no triangle/);
  });

  it("fails readably when an ASCII file holds only a malformed facet", () => {
    const buffer = asciiStl(`solid p\n${ASCII_NAN_FACET}endsolid p\n`);
    expect(() => importedShapeFromStl("nan-only.stl", buffer)).toThrowError(/no usable geometry/);
  });
});

describe("sanitizeTriangleSoup", () => {
  const triangle = (offset: number) => [offset, 0, 0, offset + 10, 0, 0, offset, 0, 10];

  it("keeps normals index-aligned with the triangles that survive", () => {
    const positions = [...triangle(0), Number.NaN, 0, 0, 1, 0, 0, 0, 0, 1, ...triangle(50)];
    const normals = [
      ...Array<number>(9).fill(1),
      ...Array<number>(9).fill(2),
      ...Array<number>(9).fill(3),
    ];
    const result = sanitizeTriangleSoup(positions, normals);
    expect(result.triangleCount).toBe(2);
    expect(result.issues.nonFinite).toBe(1);
    expect(result.normals).toHaveLength(result.positions.length);
    expect(result.normals?.slice(0, 9)).toEqual(Array<number>(9).fill(1));
    expect(result.normals?.slice(9)).toEqual(Array<number>(9).fill(3));
  });

  it("discards the normal buffer when a surviving normal is non-finite", () => {
    const normals = [...Array<number>(8).fill(0), Number.NaN];
    const result = sanitizeTriangleSoup(triangle(0), normals);
    expect(result.triangleCount).toBe(1);
    expect(result.normals).toBeUndefined();
  });

  it("ignores a normal buffer whose length does not match the positions", () => {
    const result = sanitizeTriangleSoup(triangle(0), [1, 2, 3]);
    expect(result.normals).toBeUndefined();
    expect(result.triangleCount).toBe(1);
  });

  it("counts trailing vertices that complete no triangle", () => {
    const result = sanitizeTriangleSoup([...triangle(0), 1, 2, 3, 4, 5, 6]);
    expect(result.triangleCount).toBe(1);
    expect(result.issues.danglingVertices).toBe(2);
  });

  it("reports an empty soup rather than throwing", () => {
    const result = sanitizeTriangleSoup([]);
    expect(result.triangleCount).toBe(0);
    expect(result.issues).toEqual({ nonFinite: 0, degenerate: 0, danglingVertices: 0 });
  });
});

describe("importScaleWarning", () => {
  it("stays quiet for millimetre-scale parts", () => {
    expect(importScaleWarning({ x: 84, y: 42, z: 21 })).toBeNull();
    expect(importScaleWarning({ x: 1, y: 1, z: 1 })).toBeNull();
    expect(importScaleWarning({ x: 0, y: 0, z: 0 })).toBeNull();
  });

  it("flags extents that look authored in metres", () => {
    const warning = importScaleWarning({ x: 0.084, y: 0.042, z: 0.021 });
    expect(warning).toMatch(/authored in metres/);
    expect(warning).toMatch(/0\.084 × 0\.042 × 0\.021 mm/);
    expect(warning).toMatch(/84 mm/);
  });

  it("warns on a metre-authored STL during import", () => {
    const metres: Triangle[] = FLAT_PAIR.map(
      (triangle) => triangle.map(([x, y, z]) => [x / 1000, y / 1000, z / 1000]) as Triangle,
    );
    const warnings = collectWarnings((onWarning) => {
      importedShapeFromStl("metres.stl", binaryStl(metres), { onWarning });
    });
    expect(warnings.join(" ")).toMatch(/authored in metres/);
  });
});
