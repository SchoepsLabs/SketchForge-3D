import * as THREE from "three";
import { THUMBNAIL_FOV_DEGREES, thumbnailFraming, type ShapeThumbnailPlan } from "@/lib/shapeThumbnails";

/**
 * Offscreen renderer for shape gallery tiles.
 *
 * Deliberately one shared `WebGLRenderer` for the whole panel: a context per
 * tile would burn twelve of the browser's ~16 WebGL contexts and evict the
 * viewport's own. The renderer is created on the first tile that asks for a
 * render — never at module load — so a session that never opens the gallery
 * pays nothing, which is the constraint the Block 8 speed task cares about.
 *
 * `preserveDrawingBuffer` is required: without it the buffer may be cleared
 * before `toDataURL` runs and every tile comes back transparent.
 */

let sharedRenderer: THREE.WebGLRenderer | null = null;

function acquireRenderer(): THREE.WebGLRenderer | null {
  if (sharedRenderer) return sharedRenderer;
  if (typeof document === "undefined") return null;
  try {
    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: "low-power",
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    sharedRenderer = renderer;
    return renderer;
  } catch {
    // No WebGL (headless, blocklisted driver) — tiles fall back to icon art.
    return null;
  }
}

/** Frees the shared context; called when the gallery unmounts. */
export function disposeThumbnailRenderer() {
  sharedRenderer?.dispose();
  sharedRenderer = null;
}

/** A triangular prism: the wedge's right-triangle profile, extruded along Z. */
function wedgeGeometry(width: number, height: number, depth: number) {
  const profile = new THREE.Shape();
  profile.moveTo(-width / 2, -height / 2);
  profile.lineTo(width / 2, -height / 2);
  profile.lineTo(-width / 2, height / 2);
  profile.closePath();
  const geometry = new THREE.ExtrudeGeometry(profile, { depth, bevelEnabled: false });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

/** An annulus extruded to height — the tube's bore is a real hole, not a dark face. */
function tubeGeometry(width: number, height: number) {
  const outer = width / 2;
  const inner = Math.max(0.05 * outer, outer - Math.max(1, width * 0.18));
  const profile = new THREE.Shape();
  profile.absarc(0, 0, outer, 0, Math.PI * 2, false);
  const bore = new THREE.Path();
  bore.absarc(0, 0, inner, 0, Math.PI * 2, true);
  profile.holes.push(bore);
  const geometry = new THREE.ExtrudeGeometry(profile, { depth: height, bevelEnabled: false, curveSegments: 48 });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, height / 2, 0);
  return geometry;
}

/**
 * A readable gear, not a correct one.
 *
 * The real involute generator lives in the viewport and needs CSG for the
 * centre bore; at 96 px a rim of radial teeth reads as "gear" and that is all a
 * tile has to do. Anything that depends on true tooth geometry must go through
 * the viewport's generator, never this.
 */
function gearMeshes(width: number, height: number, material: THREE.Material): THREE.Object3D[] {
  const radius = width / 2;
  const bodyRadius = radius * 0.78;
  const objects: THREE.Object3D[] = [];
  const body = new THREE.Mesh(new THREE.CylinderGeometry(bodyRadius, bodyRadius, height, 48), material);
  objects.push(body);
  const teeth = 12;
  const toothWidth = (2 * Math.PI * bodyRadius) / teeth / 2;
  for (let index = 0; index < teeth; index += 1) {
    const angle = (index / teeth) * Math.PI * 2;
    const tooth = new THREE.Mesh(new THREE.BoxGeometry(radius - bodyRadius, height, toothWidth), material);
    tooth.position.set(Math.cos(angle) * (bodyRadius + (radius - bodyRadius) / 2), 0, Math.sin(angle) * (bodyRadius + (radius - bodyRadius) / 2));
    tooth.rotation.y = -angle;
    objects.push(tooth);
  }
  return objects;
}

/** Geometry centred on the origin so the framing camera can aim at (0,0,0). */
function buildThumbnailObject(plan: ShapeThumbnailPlan, material: THREE.Material): THREE.Object3D | null {
  const { width, height, depth, kind } = plan;

  switch (kind) {
    case "box":
      return new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);

    case "cylinder": {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(width / 2, width / 2, height, 64), material);
      mesh.scale.z = depth / width;
      return mesh;
    }

    case "sphere": {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(width / 2, 40, 28), material);
      mesh.scale.set(1, height / width, depth / width);
      return mesh;
    }

    case "cone": {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0, width / 2, height, 64), material);
      mesh.scale.z = depth / width;
      return mesh;
    }

    case "pyramid": {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0, width / 2, height, 4), material);
      // A 4-gon cone starts on a corner; turn it so the tile shows a square base.
      mesh.rotation.y = Math.PI / 4;
      return mesh;
    }

    case "wedge":
      return new THREE.Mesh(wedgeGeometry(width, height, depth), material);

    case "roundRoof": {
      const geometry = new THREE.CylinderGeometry(width / 2, width / 2, depth, 48, 1, false, 0, Math.PI);
      geometry.rotateZ(-Math.PI / 2);
      geometry.rotateY(Math.PI / 2);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.scale.y = (height / (width / 2)) * 0.5;
      return mesh;
    }

    case "halfSphere": {
      const geometry = new THREE.SphereGeometry(width / 2, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.scale.set(1, height / (width / 2), depth / width);
      return mesh;
    }

    case "torus": {
      const tube = Math.max(0.5, height / 2);
      return new THREE.Mesh(new THREE.TorusGeometry(Math.max(tube, width / 2 - tube), tube, 20, 48), material);
    }

    case "tube":
      return new THREE.Mesh(tubeGeometry(width, height), material);

    case "gear": {
      const group = new THREE.Group();
      gearMeshes(width, height, material).forEach((mesh) => group.add(mesh));
      return group;
    }

    default:
      return null;
  }
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
  });
}

export type ThumbnailRenderRequest = {
  plan: ShapeThumbnailPlan;
  /** CSS pixel size of the square tile art. */
  size: number;
  pixelRatio: number;
};

/**
 * Renders one tile and returns a PNG data URL, or null when the plan has no
 * mesh art or WebGL is unavailable. Callers cache the result — this always
 * re-renders.
 */
export function renderShapeThumbnail({ plan, size, pixelRatio }: ThumbnailRenderRequest): string | null {
  if (plan.art !== "mesh") return null;
  const renderer = acquireRenderer();
  if (!renderer) return null;

  const material = new THREE.MeshStandardMaterial({
    color: plan.hole ? "#b6bfc8" : plan.color,
    roughness: 0.62,
    metalness: 0.02,
    transparent: plan.hole,
    opacity: plan.hole ? 0.55 : 1,
    side: THREE.DoubleSide,
  });

  const object = buildThumbnailObject(plan, material);
  if (!object) {
    material.dispose();
    return null;
  }

  const scene = new THREE.Scene();
  scene.add(object);
  // Matches the viewport's key/fill balance so tile art and the real object
  // read as the same material rather than two different renderers.
  scene.add(new THREE.HemisphereLight("#ffffff", "#b7cadd", 2.1));
  const key = new THREE.DirectionalLight("#ffffff", 2.6);
  key.position.set(-3, 5, 4);
  scene.add(key);
  const fill = new THREE.DirectionalLight("#cfe6ff", 1.1);
  fill.position.set(4, 2, -3);
  scene.add(fill);

  const framing = thumbnailFraming(plan.width, plan.height, plan.depth);
  const camera = new THREE.PerspectiveCamera(THUMBNAIL_FOV_DEGREES, 1, framing.near, framing.far);
  camera.position.set(framing.camera.x, framing.camera.y, framing.camera.z);
  camera.lookAt(framing.target.x, framing.target.y, framing.target.z);
  camera.updateProjectionMatrix();

  renderer.setPixelRatio(Math.min(pixelRatio, 2));
  renderer.setSize(size, size, false);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, camera);

  let dataUrl: string | null = null;
  try {
    dataUrl = renderer.domElement.toDataURL("image/png");
  } catch {
    dataUrl = null;
  }

  scene.remove(object);
  disposeObject(object);
  material.dispose();

  return dataUrl;
}
