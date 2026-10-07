import { catmullRom, greatCircle, haversineKm, nearestS, simplify, toLngLat, toXY, unwrap, type Path, type XY } from "./geo";
import { TRANSPORTS } from "./transports";
import type { Project, Route, Scene, TransportId } from "./types";

export interface LegInfo {
  index: number;
  transport: TransportId;
  /** first and last control point of the leg */
  p0: number;
  p1: number;
  /** arc-length range on the path */
  s0: number;
  s1: number;
  /** weighted (time) range: length ÷ speed */
  w0: number;
  w1: number;
  speed: number;
  km: number;
}

export interface RouteModel {
  path: Path;
  legs: LegInfo[];
  W: number;
  /** control points with longitudes unwrapped across the date line */
  points: [number, number][];
}

function legStarts(route: Route): { start: number; transport: TransportId }[] {
  const pts = route.points;
  const out = [{ start: 0, transport: pts[0]?.transport ?? route.startTransport }];
  for (let i = 1; i < pts.length - 1; i++) {
    const t = pts[i].transport;
    if (t && t !== out[out.length - 1].transport) out.push({ start: i, transport: t });
  }
  return out;
}

/** Geometry for one leg in mercator space. */
function legGeometry(route: Route, pts: [number, number][], a: number, b: number, transport: TransportId): XY[] {
  const T = TRANSPORTS[transport];
  if (T.flight) {
    const out: XY[] = [];
    for (let i = a; i < b; i++) {
      const km = haversineKm(pts[i], pts[i + 1]);
      const steps = Math.max(2, Math.min(160, Math.ceil(km / 25)));
      const arc = greatCircle(pts[i], pts[i + 1], steps).map(toXY);
      out.push(...(i === a ? arc : arc.slice(1)));
    }
    return out;
  }
  let xy = pts.slice(a, b + 1).map(toXY);
  if (route.kind === "gpx") {
    let tol = 2.5e-8; // ≈ 1 m; keep long recordings light enough to redraw every frame
    while (xy.length > 3000 && tol < 1e-4) {
      xy = simplify(xy, tol);
      tol *= 2;
    }
  }
  if (!route.smooth || xy.length < 3) return xy;
  // Smooth between hard corners: each run of points is splined separately.
  const runs: XY[][] = [[xy[0]]];
  for (let i = 1; i < xy.length; i++) {
    runs[runs.length - 1].push(xy[i]);
    const ctrl = route.kind === "drawn" ? route.points[a + i] : undefined;
    if (ctrl?.sharp && i < xy.length - 1) runs.push([xy[i]]);
  }
  const per = Math.max(2, Math.min(16, Math.floor(20000 / xy.length)));
  const out: XY[] = [];
  runs.forEach((run, k) => {
    const sm = catmullRom(run, per);
    out.push(...(k === 0 ? sm : sm.slice(1)));
  });
  return out;
}

export function buildRouteModel(route: Route): RouteModel | null {
  if (route.points.length < 2) return null;
  const pts = unwrap(route.points.map((p) => p.at)) as [number, number][];
  const starts = legStarts(route);

  const xy: XY[] = [];
  const legVerts: { v0: number; v1: number; transport: TransportId; p0: number; p1: number }[] = [];
  starts.forEach((leg, k) => {
    const p0 = leg.start;
    const p1 = k + 1 < starts.length ? starts[k + 1].start : pts.length - 1;
    const geom = legGeometry(route, pts, p0, p1, leg.transport);
    const v0 = xy.length ? xy.length - 1 : 0;
    xy.push(...(xy.length ? geom.slice(1) : geom));
    legVerts.push({ v0, v1: xy.length - 1, transport: leg.transport, p0, p1 });
  });

  // Drop zero-length steps, keeping the leg boundaries pointing at the right vertices.
  const keep: XY[] = [];
  const remap = new Int32Array(xy.length);
  for (let i = 0; i < xy.length; i++) {
    const last = keep[keep.length - 1];
    if (!last || Math.hypot(xy[i][0] - last[0], xy[i][1] - last[1]) > 1e-14) keep.push(xy[i]);
    remap[i] = keep.length - 1;
  }
  if (keep.length < 2) return null;
  const cum = [0];
  for (let i = 1; i < keep.length; i++) cum.push(cum[i - 1] + Math.hypot(keep[i][0] - keep[i - 1][0], keep[i][1] - keep[i - 1][1]));
  const path: Path = { xy: keep, lngLat: keep.map(toLngLat), cum, length: cum[cum.length - 1] };

  let w = 0;
  const legs: LegInfo[] = legVerts.map((l, index) => {
    const s0 = cum[remap[l.v0]];
    const s1 = cum[remap[l.v1]];
    const speed = TRANSPORTS[l.transport].speed;
    const w0 = w;
    w += (s1 - s0) / speed;
    let km = 0;
    for (let i = l.p0; i < l.p1; i++) km += haversineKm(pts[i], pts[i + 1]);
    return { index, transport: l.transport, p0: l.p0, p1: l.p1, s0, s1, w0, w1: w, speed, km };
  });
  return { path, legs, W: w, points: pts };
}

export function legAtS(model: RouteModel, s: number): LegInfo {
  for (const l of model.legs) if (s <= l.s1) return l;
  return model.legs[model.legs.length - 1];
}

// ---------- timeline ----------

export interface Pause {
  s: number;
  u: number;
  seconds: number;
}

export interface Timeline {
  holdStart: number;
  holdEnd: number;
  /** seconds the line spends moving */
  D: number;
  pauses: Pause[];
  total: number;
  /** when each sign pops up */
  signTimes: Record<string, number>;
  /** where each sign sits along the route */
  signS: Record<string, number>;
}

export interface TimeState {
  s: number;
  /** travel time elapsed, excluding pauses */
  u: number;
  paused: boolean;
}

const ease = (x: number, on: boolean) => (on ? 0.5 - 0.5 * Math.cos(Math.PI * x) : x);
const easeInv = (e: number, on: boolean) => (on ? Math.acos(Math.min(1, Math.max(-1, 1 - 2 * e))) / Math.PI : e);

function wFromS(m: RouteModel, s: number) {
  const l = legAtS(m, s);
  return l.w0 + (Math.min(l.s1, Math.max(l.s0, s)) - l.s0) / l.speed;
}
function sFromW(m: RouteModel, w: number) {
  let l = m.legs[m.legs.length - 1];
  for (const leg of m.legs) {
    if (w <= leg.w1) {
      l = leg;
      break;
    }
  }
  return Math.min(l.s1, l.s0 + (w - l.w0) * l.speed);
}

export function makeTimeline(model: RouteModel | null, scene: Scene, output: Project["output"]): Timeline {
  const D = Math.max(0.5, scene.timing.duration);
  const easeOn = scene.timing.easing === "ease";
  const pauses: Pause[] = [];
  const signTimes: Record<string, number> = {};
  const signS: Record<string, number> = {};
  if (model) {
    const uAtS = (s: number) => (model.W > 0 ? D * easeInv(wFromS(model, s) / model.W, easeOn) : 0);
    scene.route.points.forEach((p, i) => {
      if (p.pause && p.pause > 0 && scene.route.kind === "drawn") {
        const s = nearestS(model.path, toXY(model.points[i]));
        pauses.push({ s, u: uAtS(s), seconds: p.pause });
      }
    });
    for (const sign of scene.signs) {
      const s = nearestS(model.path, toXY(sign.at));
      signS[sign.id] = s;
      if (sign.pause > 0) pauses.push({ s, u: uAtS(s), seconds: sign.pause });
    }
    pauses.sort((a, b) => a.u - b.u);
    for (const sign of scene.signs) {
      const u = uAtS(signS[sign.id]);
      const before = pauses.filter((p) => p.u < u - 1e-9).reduce((a, p) => a + p.seconds, 0);
      signTimes[sign.id] = output.holdStart + u + before;
    }
  }
  const pauseTotal = pauses.reduce((a, p) => a + p.seconds, 0);
  return {
    holdStart: output.holdStart,
    holdEnd: output.holdEnd,
    D,
    pauses,
    total: output.holdStart + D + pauseTotal + output.holdEnd,
    signTimes,
    signS,
  };
}

export function timeState(model: RouteModel, tl: Timeline, t: number, easing: Scene["timing"]["easing"]): TimeState {
  let u = t - tl.holdStart;
  let paused = false;
  if (u <= 0) return { s: 0, u: 0, paused: false };
  for (const p of tl.pauses) {
    if (u <= p.u) break;
    if (u <= p.u + p.seconds) {
      u = p.u;
      paused = true;
      break;
    }
    u -= p.seconds;
  }
  u = Math.min(u, tl.D);
  const e = ease(u / tl.D, easing === "ease");
  return { s: sFromW(model, e * model.W), u, paused };
}

export function projectDuration(project: Project, models: (RouteModel | null)[]): number {
  return project.scenes.reduce((a, s, i) => a + makeTimeline(models[i], s, project.output).total, 0);
}
