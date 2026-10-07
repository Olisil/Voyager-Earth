import { chordBearing, pointAt, toLngLat, toXY, type Path, type XY } from "./geo";
import { legAtS, timeState, type LegInfo, type RouteModel, type Timeline } from "./model";
import type { LngLat, SavedView, Scene } from "./types";

export interface CameraState {
  center: LngLat;
  zoom: number;
  bearing: number;
  pitch: number;
}

export interface FrameState {
  t: number;
  s: number;
  tip: LngLat;
  /** direction of travel at the tip, degrees from north */
  tipBearing: number;
  leg: LegInfo;
  /** null = leave the map where the user put it */
  camera: CameraState | null;
}

const STEADINESS = { tight: 0.06, smooth: 0.22, very: 0.45 } as const;
type Viewport = { width: number; height: number };

function slide(s: number, before: number, after: number, L: number): [number, number] {
  let a = s - before;
  let b = s + after;
  if (a < 0) {
    b = Math.min(L, b - a);
    a = 0;
  }
  if (b > L) {
    a = Math.max(0, a - (b - L));
    b = L;
  }
  return [a, b];
}

const smooth = (x: number) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
function lerpAngle(a: number, b: number, k: number) {
  let d = ((b - a + 540) % 360) - 180;
  if (d < -180) d += 360;
  return a + d * k;
}

export function blendViews(a: CameraState, b: CameraState, k: number): CameraState {
  const pa = toXY(a.center);
  const pb = toXY(b.center);
  // Unwrap so the blend takes the short way round the globe.
  let bx = pb[0];
  if (bx - pa[0] > 0.5) bx -= 1;
  if (bx - pa[0] < -0.5) bx += 1;
  return {
    center: toLngLat([lerp(pa[0], bx, k), lerp(pa[1], pb[1], k)]),
    zoom: lerp(a.zoom, b.zoom, k),
    bearing: lerpAngle(a.bearing, b.bearing, k),
    pitch: lerp(a.pitch, b.pitch, k),
  };
}

/** The view that shows the whole path, worked out without a map instance. */
export function fitView(path: Path, vp: Viewport, padding = 0.1): CameraState {
  let [x0, y0] = path.xy[0];
  let [x1, y1] = path.xy[0];
  for (const [x, y] of path.xy) {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  const w = vp.width * (1 - padding * 2);
  const h = vp.height * (1 - padding * 2);
  const zoom = Math.log2(Math.min(w / (Math.max(x1 - x0, 1e-9) * 512), h / (Math.max(y1 - y0, 1e-9) * 512)));
  return { center: toLngLat([(x0 + x1) / 2, (y0 + y1) / 2]), zoom: Math.max(0.5, Math.min(15, zoom)), bearing: 0, pitch: 0 };
}

function followCamera(scene: Scene, path: Path, s: number, vp: Viewport): CameraState {
  const cam = scene.camera;
  const L = path.length;
  const span = Math.min(vp.width, vp.height) / (512 * Math.pow(2, cam.zoom));
  const w = STEADINESS[cam.steadiness] * span;
  const ahead = cam.lookAhead * span;
  const target = s + ahead;
  let cx = 0;
  let cy = 0;
  let wsum = 0;
  for (let k = -6; k <= 6; k++) {
    const weight = 7 - Math.abs(k);
    const p: XY = pointAt(path, target + (k / 6) * w);
    cx += p[0] * weight;
    cy += p[1] * weight;
    wsum += weight;
  }
  let bearing = 0;
  if (cam.up === "travel") {
    const reach = Math.max(w, span * 0.05) * 1.6;
    const [a, b] = slide(s, reach, reach + ahead, L);
    bearing = chordBearing(path, a, b) ?? 0;
  }
  return { center: toLngLat([cx / wsum, cy / wsum]), zoom: cam.zoom, bearing, pitch: cam.pitch };
}

const asState = (v: SavedView): CameraState => ({ center: v.center, zoom: v.zoom, bearing: v.bearing, pitch: v.pitch });

/**
 * Everything about one moment of a scene, from the scene and the time alone.
 * Preview and export both call this, so what you scrub is exactly what renders.
 */
export function frameAt(scene: Scene, model: RouteModel, tl: Timeline, t: number, vp: Viewport): FrameState {
  const { path } = model;
  const { s, u } = timeState(model, tl, t, scene.timing.easing);
  const span = Math.min(vp.width, vp.height) / (512 * Math.pow(2, scene.camera.zoom));
  const [ta, tb] = slide(s, span * 0.01, span * 0.01, path.length);
  const tipBearing = chordBearing(path, ta, tb) ?? 0;
  const cam = scene.camera;

  let camera: CameraState | null = null;
  if (cam.mode === "fixed") {
    camera = cam.fixedView ? asState(cam.fixedView) : null;
  } else if (cam.mode === "glide") {
    const a = cam.startView ? asState(cam.startView) : fitView(path, vp);
    const b = cam.endView ? asState(cam.endView) : fitView(path, vp);
    const moving = tl.total - tl.holdStart - tl.holdEnd;
    camera = blendViews(a, b, smooth((t - tl.holdStart) / Math.max(0.01, moving)));
  } else {
    camera = followCamera(scene, path, s, vp);
    const window = Math.min(2.5, tl.D * 0.3);
    if (cam.openWide && u < window) camera = blendViews(fitView(path, vp), camera, smooth(u / window));
    if (cam.closeWide && u > tl.D - window) {
      const k = smooth((u - (tl.D - window)) / window);
      camera = blendViews(camera, fitView(path, vp), k);
    }
  }
  return { t, s, tip: toLngLat(pointAt(path, s)), tipBearing, leg: legAtS(model, s), camera };
}
