import maplibregl, { type GeoJSONSource, type Map as MLMap, type StyleSpecification } from "maplibre-gl";
import type { FrameState } from "./camera";
import { pointAt, toLngLat, type Path } from "./geo";
import type { RouteModel } from "./model";
import type { LngLat, Scene, ThemeId } from "./types";

export interface Theme {
  id: ThemeId;
  label: string;
  /** land, water, road: used to draw the swatch */
  swatch: [string, string, string];
  style: string | StyleSpecification;
}

const satellite: StyleSpecification = {
  version: 8,
  sources: {
    sat: {
      type: "raster",
      tiles: ["https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg"],
      tileSize: 256,
      maxzoom: 14,
      attribution:
        '<a href="https://s2maps.eu" target="_blank" rel="noopener">Sentinel-2 cloudless</a> by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2016)',
    },
  },
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#0e2230" } },
    { id: "sat", type: "raster", source: "sat" },
  ],
};

export const THEMES: Theme[] = [
  { id: "dark", label: "Dark", swatch: ["#1b1b1b", "#0b0b0b", "#3a3a3a"], style: "https://tiles.openfreemap.org/styles/dark" },
  { id: "fiord", label: "Fiord", swatch: ["#45516e", "#38435c", "#7a8aa6"], style: "https://tiles.openfreemap.org/styles/fiord" },
  { id: "positron", label: "Light", swatch: ["#f2f2f0", "#cfd8dc", "#b9b9b9"], style: "https://tiles.openfreemap.org/styles/positron" },
  { id: "liberty", label: "Road atlas", swatch: ["#f8f4f0", "#a0c8f0", "#e9ac77"], style: "https://tiles.openfreemap.org/styles/liberty" },
  { id: "bright", label: "Bright", swatch: ["#f8f4f0", "#a0c8f0", "#fdbf6f"], style: "https://tiles.openfreemap.org/styles/bright" },
  { id: "satellite", label: "Satellite", swatch: ["#3e5a3a", "#16324a", "#a39572"], style: satellite },
];

const TERRAIN_TILES = "https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png";

export const SRC = { full: "fv-full", drawn: "fv-drawn", ctrl: "fv-ctrl", dem: "fv-dem" } as const;
export const LYR = {
  hillshade: "fv-hillshade",
  ahead: "fv-ahead",
  casing: "fv-casing",
  solid: "fv-line-solid",
  dashed: "fv-line-dashed",
  dotted: "fv-line-dotted",
  ctrl: "fv-ctrl",
  ctrlEnds: "fv-ctrl-ends",
} as const;
export const HANDLE_LAYERS = [LYR.ctrl, LYR.ctrlEnds];

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const currentTheme = new WeakMap<MLMap, ThemeId>();

export function createMap(container: HTMLElement, scene: Scene): MLMap {
  const theme = THEMES.find((t) => t.id === scene.look.theme) ?? THEMES[0];
  const v = scene.view;
  const map = new maplibregl.Map({
    container,
    style: theme.style,
    center: v?.center ?? [18.07, 59.33],
    zoom: v?.zoom ?? 7,
    bearing: v?.bearing ?? 0,
    pitch: v?.pitch ?? 0,
    attributionControl: { compact: true },
    // Needed so finished frames can be copied off the canvas into the video.
    canvasContextAttributes: { preserveDrawingBuffer: true, antialias: true },
    maxCanvasSize: [8192, 8192],
    maxPitch: 70,
    fadeDuration: 0,
  });
  currentTheme.set(map, theme.id);
  return map;
}

function firstSymbolLayer(map: MLMap): string | undefined {
  return map.getStyle().layers?.find((l) => l.type === "symbol" && !l.id.startsWith("fv-"))?.id;
}

/** Adds the app's sources and layers. Safe to call again after a style change. */
export function installScene(map: MLMap) {
  const below = firstSymbolLayer(map);
  for (const id of [SRC.full, SRC.drawn, SRC.ctrl]) {
    if (!map.getSource(id)) map.addSource(id, { type: "geojson", data: EMPTY });
  }
  if (!map.getSource(SRC.dem)) {
    map.addSource(SRC.dem, {
      type: "raster-dem",
      tiles: [TERRAIN_TILES],
      tileSize: 256,
      maxzoom: 15,
      encoding: "terrarium",
      attribution:
        '<a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener">Terrain: Mapzen &amp; others</a>',
    });
  }
  const add = (layer: maplibregl.AddLayerObject, before?: string) => {
    if (!map.getLayer(layer.id)) map.addLayer(layer, before);
  };
  add(
    {
      id: LYR.hillshade,
      type: "hillshade",
      source: SRC.dem,
      layout: { visibility: "none" },
      paint: { "hillshade-exaggeration": 0.4, "hillshade-shadow-color": "#1a2026", "hillshade-highlight-color": "#ffffff" },
    },
    below,
  );
  add(
    {
      id: LYR.ahead,
      type: "line",
      source: SRC.full,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": ["get", "color"], "line-opacity": 0.4, "line-width": 2, "line-dasharray": [1.5, 2] },
    },
    below,
  );
  add(
    {
      id: LYR.casing,
      type: "line",
      source: SRC.drawn,
      layout: { "line-join": "round", "line-cap": "round", visibility: "none" },
      paint: { "line-color": "#ffffff", "line-width": ["+", ["get", "width"], 4] },
    },
    below,
  );
  const line = (id: string, kind: string, dash?: number[]) =>
    add(
      {
        id,
        type: "line",
        source: SRC.drawn,
        filter: ["==", ["get", "line"], kind],
        layout: { "line-join": "round", "line-cap": kind === "solid" ? "round" : "round" },
        paint: { "line-color": ["get", "color"], "line-width": ["get", "width"], ...(dash ? { "line-dasharray": dash } : {}) },
      },
      below,
    );
  line(LYR.solid, "solid");
  line(LYR.dashed, "dashed", [2, 1.6]);
  line(LYR.dotted, "dotted", [0.01, 1.9]);
  add({
    id: LYR.ctrl,
    type: "circle",
    source: SRC.ctrl,
    paint: {
      "circle-radius": ["case", ["has", "legStart"], 7, 5],
      "circle-color": ["case", ["has", "legStart"], ["get", "legColor"], "#0e0e0e"],
      "circle-stroke-color": ["case", ["has", "pause"], "#e6ff4c", "#ffffff"],
      "circle-stroke-width": ["case", ["has", "pause"], 3.5, 2],
    },
  });
  add({
    id: LYR.ctrlEnds,
    type: "circle",
    source: SRC.ctrl,
    filter: ["has", "end"],
    paint: {
      "circle-radius": 7,
      "circle-color": ["match", ["get", "end"], "start", "#bad70a", "#ffffff"],
      "circle-stroke-color": "#0e0e0e",
      "circle-stroke-width": 2.5,
    },
  });
}

export function applyLook(map: MLMap, scene: Scene) {
  if (!map.getLayer(LYR.solid)) return;
  const look = scene.look;
  map.setLayoutProperty(LYR.casing, "visibility", look.outline ? "visible" : "none");
  map.setLayoutProperty(LYR.ahead, "visibility", look.showAhead ? "visible" : "none");
  map.setLayoutProperty(LYR.hillshade, "visibility", look.terrain ? "visible" : "none");
  const terrainOn = !!map.getTerrain();
  if (look.terrain && !terrainOn) map.setTerrain({ source: SRC.dem, exaggeration: 1.4 });
  if (!look.terrain && terrainOn) map.setTerrain(null);
  for (const l of map.getStyle().layers ?? []) {
    if (l.type === "symbol" && !l.id.startsWith("fv-")) {
      const want = look.placeNames ? "visible" : "none";
      if (map.getLayoutProperty(l.id, "visibility") !== want) map.setLayoutProperty(l.id, "visibility", want);
    }
  }
}

const pending = new WeakMap<MLMap, { theme: ThemeId; promise: Promise<boolean> }>();

/** Switches the base map if needed and puts the app's layers back. */
export function ensureTheme(map: MLMap, scene: Scene): Promise<boolean> {
  const inFlight = pending.get(map);
  if (inFlight) {
    // Another switch is loading: wait for it, then check again.
    return inFlight.promise.then(() => ensureTheme(map, scene));
  }
  if (currentTheme.get(map) === scene.look.theme && map.getLayer(LYR.solid)) {
    applyLook(map, scene);
    return Promise.resolve(false);
  }
  const theme = THEMES.find((t) => t.id === scene.look.theme) ?? THEMES[0];
  currentTheme.set(map, theme.id);
  const promise = new Promise<boolean>((resolve) => {
    map.once("style.load", () => {
      installScene(map);
      applyLook(map, scene);
      pending.delete(map);
      resolve(true);
    });
    map.setStyle(theme.style, { diff: false });
  });
  pending.set(map, { theme: theme.id, promise });
  return promise;
}

function src(map: MLMap, id: string): GeoJSONSource | undefined {
  return map.getSource(id) as GeoJSONSource | undefined;
}

/** Coordinates of the path between two arc lengths. */
export function sliceRange(path: Path, a: number, b: number): LngLat[] {
  if (b <= a) return [];
  const out: LngLat[] = [toLngLat(pointAt(path, a))];
  for (let i = 0; i < path.cum.length; i++) {
    if (path.cum[i] > a && path.cum[i] < b) out.push(path.lngLat[i]);
    if (path.cum[i] >= b) break;
  }
  out.push(toLngLat(pointAt(path, b)));
  return out;
}

function legFeatures(scene: Scene, model: RouteModel, upTo: number): GeoJSON.Feature[] {
  const feats: GeoJSON.Feature[] = [];
  for (const leg of model.legs) {
    const end = Math.min(leg.s1, upTo);
    if (end <= leg.s0) continue;
    const coords = sliceRange(model.path, leg.s0, end);
    if (coords.length < 2) continue;
    const st = scene.look.transports[leg.transport];
    feats.push({
      type: "Feature",
      properties: { color: st.color, width: st.width, line: st.line, leg: leg.index },
      geometry: { type: "LineString", coordinates: coords },
    });
  }
  return feats;
}

/** Editing view: the whole route, plus handles when the route is drawn. */
export function showEditing(map: MLMap, scene: Scene, model: RouteModel | null, handles: boolean) {
  src(map, SRC.full)?.setData(EMPTY);
  src(map, SRC.drawn)?.setData({ type: "FeatureCollection", features: model ? legFeatures(scene, model, Infinity) : [] });
  const pts = scene.route.points;
  const unwrapped = model?.points ?? pts.map((p) => p.at);
  let features: GeoJSON.Feature[] = [];
  if (handles && scene.route.kind === "drawn") {
    const legStartIdx = new Map((model?.legs ?? []).map((l) => [l.p0, l.transport]));
    features = pts.map((p, i) => {
      const legT = i > 0 ? legStartIdx.get(i) : undefined;
      return {
        type: "Feature",
        properties: {
          i,
          ...(i === 0 ? { end: "start" } : i === pts.length - 1 ? { end: "finish" } : {}),
          ...(legT ? { legStart: 1, legColor: scene.look.transports[legT].color } : {}),
          ...(p.pause ? { pause: p.pause } : {}),
        },
        geometry: { type: "Point", coordinates: unwrapped[i] ?? p.at },
      };
    });
  } else if (handles && pts.length) {
    features = [0, pts.length - 1].map((i, k) => ({
      type: "Feature",
      properties: { i, end: k === 0 ? "start" : "finish" },
      geometry: { type: "Point", coordinates: unwrapped[i] },
    }));
  }
  src(map, SRC.ctrl)?.setData({ type: "FeatureCollection", features });
}

/** Animation view: the line drawn up to the frame, and optionally the camera. */
export function showFrame(map: MLMap, scene: Scene, model: RouteModel, frame: FrameState, moveCamera: boolean) {
  src(map, SRC.ctrl)?.setData(EMPTY);
  src(map, SRC.full)?.setData({ type: "FeatureCollection", features: legFeatures(scene, model, Infinity) });
  src(map, SRC.drawn)?.setData({ type: "FeatureCollection", features: legFeatures(scene, model, frame.s) });
  if (moveCamera && frame.camera) map.jumpTo(frame.camera);
}

/** Resolves once every tile and source update for the current view has been drawn. */
export function waitForIdle(map: MLMap, timeoutMs = 20000): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      map.off("idle", finish);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    map.on("idle", finish);
    map.triggerRepaint();
  });
}
