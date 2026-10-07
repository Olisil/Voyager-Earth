import type { Map as MLMap, MapMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createMap, HANDLE_LAYERS, installScene } from "../lib/mapScene";
import { cachedImage, drawOverlay, type Hit, type OverlayInput } from "../lib/overlay";
import type { LngLat, SavedView, Scene } from "../lib/types";

export type Interaction =
  | { kind: "draw" }
  | { kind: "move" }
  | { kind: "signs"; placing: boolean }
  | { kind: "none" };

export type OverlayBase = Omit<OverlayInput, "toScreen" | "mapBearing" | "width" | "height" | "scale" | "image">;

interface Props {
  scene: Scene;
  width: number;
  height: number;
  interaction: Interaction;
  overlay: React.MutableRefObject<OverlayBase | null>;
  overlayKey: unknown;
  /** re-render children on every map move (for popovers pinned to the map) */
  trackMoves: boolean;
  children?: (toScreen: (ll: LngLat) => { x: number; y: number }) => ReactNode;
  onReady: (map: MLMap) => void;
  onAddPoint: (p: LngLat) => void;
  onMovePoint: (i: number, p: LngLat, commit: boolean) => void;
  onPointClick: (i: number) => void;
  onToggleSharp: (i: number) => void;
  onPlaceSign: (p: LngLat) => void;
  onMoveSign: (id: string, p: LngLat, commit: boolean) => void;
  onSelectSign: (id: string | null) => void;
  onViewChange: (v: SavedView) => void;
}

const DPR = () => Math.min(2, window.devicePixelRatio || 1);

export function MapStage(props: Props) {
  const el = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const hits = useRef<Hit[]>([]);
  const latest = useRef(props);
  latest.current = props;
  const [, setMoveTick] = useState(0);

  const redraw = useRef(() => {});
  redraw.current = () => {
    const map = mapRef.current;
    const c = canvas.current;
    if (!map || !c) return;
    const { width, height } = latest.current;
    const dpr = DPR();
    if (c.width !== Math.round(width * dpr) || c.height !== Math.round(height * dpr)) {
      c.width = Math.round(width * dpr);
      c.height = Math.round(height * dpr);
    }
    const g = c.getContext("2d")!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, c.width, c.height);
    const base = latest.current.overlay.current;
    if (!base) return;
    hits.current = drawOverlay(g, {
      ...base,
      toScreen: (ll) => map.project(ll),
      mapBearing: map.getBearing(),
      width,
      height,
      scale: dpr,
      image: (u) => cachedImage(u, () => redraw.current()),
    });
  };

  useEffect(() => {
    const map = createMap(el.current!, latest.current.scene);
    mapRef.current = map;

    let dragPoint: number | null = null;
    let dragSign: string | null = null;
    let downAt: { x: number; y: number } | null = null;
    let moved = false;
    let lastClick = { i: -1, time: 0 };

    const handleAt = (e: MapMouseEvent): number | null => {
      const layers = HANDLE_LAYERS.filter((l) => map.getLayer(l));
      if (!layers.length) return null;
      const hit = map.queryRenderedFeatures(
        [
          [e.point.x - 6, e.point.y - 6],
          [e.point.x + 6, e.point.y + 6],
        ],
        { layers },
      );
      const i = hit[0]?.properties?.i;
      return typeof i === "number" ? i : null;
    };
    const signAt = (e: MapMouseEvent): string | null => {
      for (let k = hits.current.length - 1; k >= 0; k--) {
        const h = hits.current[k];
        if (e.point.x >= h.x && e.point.x <= h.x + h.w && e.point.y >= h.y && e.point.y <= h.y + h.h) return h.id;
      }
      return null;
    };
    const ll = (e: MapMouseEvent): LngLat => [e.lngLat.lng, e.lngLat.lat];

    const onDown = (e: MapMouseEvent) => {
      if (e.originalEvent.button !== 0) return;
      const mode = latest.current.interaction.kind;
      downAt = { x: e.point.x, y: e.point.y };
      moved = false;
      if (mode === "draw") {
        const i = handleAt(e);
        if (i !== null) {
          e.preventDefault();
          dragPoint = i;
        }
      } else if (mode === "signs") {
        const id = signAt(e);
        if (id) {
          e.preventDefault();
          dragSign = id;
          latest.current.onSelectSign(id);
        }
      }
    };
    const onMove = (e: MapMouseEvent) => {
      const mode = latest.current.interaction.kind;
      if (downAt && Math.hypot(e.point.x - downAt.x, e.point.y - downAt.y) > 3) moved = true;
      if (dragPoint !== null && moved) {
        map.getCanvas().style.cursor = "grabbing";
        latest.current.onMovePoint(dragPoint, ll(e), false);
        return;
      }
      if (dragSign && moved) {
        map.getCanvas().style.cursor = "grabbing";
        latest.current.onMoveSign(dragSign, ll(e), false);
        return;
      }
      if (mode === "draw") map.getCanvas().style.cursor = handleAt(e) !== null ? "pointer" : "crosshair";
      else if (mode === "signs") {
        const placing = latest.current.interaction.kind === "signs" && (latest.current.interaction as { placing: boolean }).placing;
        map.getCanvas().style.cursor = signAt(e) ? "grab" : placing ? "crosshair" : "";
      }
    };
    const onUp = (e: MapMouseEvent) => {
      if (dragPoint !== null) {
        const i = dragPoint;
        dragPoint = null;
        if (moved) latest.current.onMovePoint(i, ll(e), true);
        else {
          const now = performance.now();
          if (lastClick.i === i && now - lastClick.time < 350) latest.current.onToggleSharp(i);
          else latest.current.onPointClick(i);
          lastClick = { i, time: now };
        }
      }
      if (dragSign) {
        const id = dragSign;
        dragSign = null;
        if (moved) latest.current.onMoveSign(id, ll(e), true);
      }
      downAt = null;
    };
    const onClick = (e: MapMouseEvent) => {
      const it = latest.current.interaction;
      if (it.kind === "draw") {
        if (handleAt(e) !== null) return;
        latest.current.onAddPoint(ll(e));
      } else if (it.kind === "signs") {
        if (signAt(e)) return;
        if (it.placing) latest.current.onPlaceSign(ll(e));
        else latest.current.onSelectSign(null);
      }
    };
    let raf = 0;
    const onMapMove = () => {
      if (!latest.current.trackMoves || raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setMoveTick((n) => n + 1);
      });
    };
    const onMoveEnd = () => {
      const c = map.getCenter();
      latest.current.onViewChange({ center: [c.lng, c.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() });
    };

    map.once("style.load", () => {
      installScene(map);
      map.on("mousedown", onDown);
      map.on("mousemove", onMove);
      map.on("mouseup", onUp);
      map.on("click", onClick);
      map.on("move", onMapMove);
      map.on("moveend", onMoveEnd);
      map.on("render", () => redraw.current());
      latest.current.onReady(map);
    });
    return () => {
      cancelAnimationFrame(raf);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const k = props.interaction.kind;
    map.getCanvas().style.cursor = k === "draw" || (k === "signs" && props.interaction.placing) ? "crosshair" : "";
    if (k === "draw") map.doubleClickZoom.disable();
    else map.doubleClickZoom.enable();
  }, [props.interaction]);

  useEffect(() => {
    mapRef.current?.resize();
    redraw.current();
  }, [props.width, props.height]);

  useEffect(() => {
    redraw.current();
  }, [props.overlayKey]);

  const map = mapRef.current;
  return (
    <>
      <div ref={el} className="map" style={{ width: props.width, height: props.height }} />
      <canvas ref={canvas} className="overlay" style={{ width: props.width, height: props.height }} aria-hidden />
      {map && props.children?.((p) => map.project(p))}
    </>
  );
}
