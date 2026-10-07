import type { Map as MLMap } from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { frameAt } from "../lib/camera";
import { downloadBlob, downloadProjectFile, duplicateProject, getProject, importProjectFile, saveProject, slug } from "../lib/db";
import { creditFor, ExportUnsupportedError, renderVideo } from "../lib/exporter";
import { boundsOf, haversineKm, parseGpx } from "../lib/geo";
import { ensureTheme, showEditing, showFrame } from "../lib/mapScene";
import { buildRouteModel, makeTimeline, type RouteModel } from "../lib/model";
import { navigate } from "../router";
import { NassauLogo, ThemeToggle } from "../theme";
import { ASPECTS, newScene, uid, type Aspect, type LngLat, type Project, type Route, type SavedView, type Scene, type SignStyle, type TransportId } from "../lib/types";
import { MapStage, type Interaction, type OverlayBase } from "./MapStage";
import { LegsPanel, PointPopover, SearchBox } from "./MapWidgets";
import { CameraPanel } from "./panels/CameraPanel";
import { ExportPanel, type RenderState } from "./panels/ExportPanel";
import { LookPanel } from "./panels/LookPanel";
import { RoutePanel } from "./panels/RoutePanel";
import { SignsPanel } from "./panels/SignsPanel";
import { SceneTabs } from "./SceneTabs";
import { Segmented } from "./Controls";

type Step = "route" | "look" | "signs" | "camera" | "export";
const STEPS: { id: Step; label: string; next: string }[] = [
  { id: "route", label: "Route", next: "Next: choose the look" },
  { id: "look", label: "Look", next: "Next: add signs" },
  { id: "signs", label: "Signs", next: "Next: set up the camera" },
  { id: "camera", label: "Camera", next: "Next: preview & export" },
  { id: "export", label: "Preview & export", next: "" },
];

const modelCache = new WeakMap<Route, RouteModel | null>();
function modelFor(route: Route): RouteModel | null {
  if (!modelCache.has(route)) modelCache.set(route, buildRouteModel(route));
  return modelCache.get(route)!;
}

function fmtTime(t: number) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

function routeKm(route: Route) {
  let km = 0;
  for (let i = 1; i < route.points.length; i++) km += haversineKm(route.points[i - 1].at, route.points[i].at);
  return km;
}

export function Editor({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let live = true;
    getProject(projectId)
      .then((p) => {
        if (!live) return;
        if (p) setProject(p);
        else setMissing(true);
      })
      .catch(() => live && setMissing(true));
    return () => {
      live = false;
    };
  }, [projectId]);

  if (missing)
    return (
      <div className="empty-page">
        <h1>This project isn't in this browser</h1>
        <p>Projects are saved in the browser they were made in. Open the project file instead, or start a new one.</p>
        <a className="btn btn-primary" href="#/">
          Go to your projects
        </a>
      </div>
    );
  if (!project) return <div className="empty-page" aria-busy="true" />;
  return <EditorLoaded key={project.id} initial={project} />;
}

function EditorLoaded({ initial }: { initial: Project }) {
  const [project, setProject] = useState<Project>(initial);
  const [sceneIdx, setSceneIdx] = useState(0);
  const [step, setStep] = useState<Step>(initial.scenes[0].route.points.length ? "look" : "route");
  const [map, setMap] = useState<MLMap | null>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [tool, setTool] = useState<"draw" | "move">("draw");
  const [selectedPoint, setSelectedPoint] = useState<number | null>(null);
  const [selectedSign, setSelectedSign] = useState<string | null>(null);
  const [placing, setPlacing] = useState<SignStyle | null>(null);
  const [focusTransport, setFocusTransport] = useState<TransportId | null>(null);
  const [history, setHistory] = useState<Route[]>([]);
  const [render, setRender] = useState<RenderState>({ status: "idle" });
  const [notice, setNotice] = useState<string | null>(null);
  const [frame, setFrame] = useState({ w: 0, h: 0 });
  const [dragOver, setDragOver] = useState(false);
  const [overlayKey, setOverlayKey] = useState(0);
  const [projectMenu, setProjectMenu] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const overlayRef = useRef<OverlayBase | null>(null);
  const projectRef = useRef(project);
  projectRef.current = project;

  const scene = project.scenes[Math.min(sceneIdx, project.scenes.length - 1)];
  const model = modelFor(scene.route);
  const timeline = useMemo(() => makeTimeline(model, scene, project.output), [model, scene, project.output]);
  const duration = timeline.total;
  const sceneSeconds = project.scenes.map((s) => makeTimeline(modelFor(s.route), s, project.output).total);
  const rendering = render.status === "rendering";
  const lastTransport = model?.legs[model.legs.length - 1]?.transport ?? scene.route.startTransport;
  const [travelBy, setTravelBy] = useState<TransportId>(lastTransport);

  const mode: "route-edit" | "sign-edit" | "frame" =
    !playing && !previewing && step === "route" ? "route-edit" : !playing && !previewing && step === "signs" ? "sign-edit" : "frame";

  // ---- updates
  const updateProject = useCallback((fn: (p: Project) => Project) => setProject(fn), []);
  const updateScene = useCallback(
    (fn: (s: Scene) => Scene) =>
      setProject((p) => ({ ...p, scenes: p.scenes.map((s, i) => (i === Math.min(sceneIdx, p.scenes.length - 1) ? fn(s) : s)) })),
    [sceneIdx],
  );
  const setRoute = useCallback(
    (route: Route, commit = true) => {
      if (commit) {
        const before = projectRef.current.scenes[sceneIdx]?.route;
        if (before) setHistory((h) => [...h.slice(-99), before]);
      }
      updateScene((s) => ({ ...s, route }));
    },
    [sceneIdx, updateScene],
  );

  // ---- autosave
  useEffect(() => {
    const id = setTimeout(() => {
      saveProject({ ...project, updatedAt: Date.now() }).catch(() => setNotice("Couldn't save to this browser. Download the project file to keep your work."));
    }, 500);
    return () => clearTimeout(id);
  }, [project]);

  // ---- stage sizing
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ratio = ASPECTS[project.output.aspect].ratio;
    const fit = () => {
      const pad = window.innerWidth < 820 ? 10 : 24;
      const aw = Math.max(100, el.clientWidth - pad * 2);
      const ah = Math.max(100, el.clientHeight - pad * 2);
      const w = Math.min(aw, ah * ratio);
      setFrame({ w: Math.floor(w), h: Math.floor(w / ratio) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [project.output.aspect]);

  // ---- map framing helpers
  const fitRoute = useCallback(
    (sc: Scene, animate = true) => {
      const b = boundsOf(modelFor(sc.route)?.points ?? sc.route.points.map((p) => p.at));
      if (!map || !b) return false;
      map.fitBounds(b, { padding: Math.min(80, frame.w / 8), duration: animate ? 700 : 0, bearing: 0, pitch: 0, maxZoom: 13 });
      return true;
    },
    [map, frame.w],
  );

  // When the scene changes (or the map first appears), go to where that scene was last edited.
  const shownScene = useRef<string | null>(null);
  useEffect(() => {
    if (!map || frame.w === 0 || shownScene.current === scene.id) return;
    shownScene.current = scene.id;
    if (scene.view) map.jumpTo(scene.view);
    else fitRoute(scene, false);
    setTravelBy(lastTransport);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, scene.id, frame.w]);

  // ---- what the map shows
  useEffect(() => {
    if (!map || rendering) return;
    let cancelled = false;
    ensureTheme(map, scene).then(() => {
      if (cancelled) return;
      if (mode !== "frame" || !model) {
        showEditing(map, scene, model, mode === "route-edit");
        overlayRef.current = { scene, frame: null, timeline, t: null, credit: null, selectedSign: step === "signs" ? selectedSign : null };
      } else {
        const f = frameAt(scene, model, timeline, Math.min(t, duration), { width: frame.w, height: frame.h });
        showFrame(map, scene, model, f, true);
        overlayRef.current = { scene, frame: f, timeline, t: Math.min(t, duration), credit: project.output.credit ? creditFor(scene) : null };
      }
      setOverlayKey((k) => k + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [map, scene, model, timeline, t, duration, mode, rendering, frame.w, frame.h, selectedSign, step, project.output.credit]);

  // ---- playback
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      let done = false;
      setT((prev) => {
        const next = prev + dt;
        if (next >= duration) {
          done = true;
          return duration;
        }
        return next;
      });
      if (done) setPlaying(false);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, duration]);

  const togglePlay = useCallback(() => {
    if (!model || rendering) return;
    if (!playing && t >= duration - 0.01) setT(0);
    setSelectedPoint(null);
    setPlaying(!playing);
  }, [model, rendering, playing, t, duration]);

  // ---- keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(tag);
      if (e.key === "Escape") {
        setPlacing(null);
        setSelectedPoint(null);
      }
      if (typing) return;
      if (e.code === "Space" && tag !== "BUTTON") {
        e.preventDefault();
        togglePlay();
      }
      if ((e.key === "Delete" || e.key === "Backspace") && step === "signs" && selectedSign) {
        e.preventDefault();
        updateScene((s) => ({ ...s, signs: s.signs.filter((x) => x.id !== selectedSign) }));
        setSelectedSign(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, step, selectedSign, updateScene]);

  // ---- route editing
  const addPoint = (at: LngLat) => {
    const r = scene.route;
    if (r.kind === "gpx") return;
    if (!r.points.length) {
      setRoute({ ...r, points: [{ at }], startTransport: travelBy });
      return;
    }
    const pts = r.points.slice();
    let startTransport = r.startTransport;
    if (lastTransport !== travelBy) {
      if (pts.length === 1) startTransport = travelBy;
      else pts[pts.length - 1] = { ...pts[pts.length - 1], transport: travelBy };
    }
    pts.push({ at });
    setRoute({ ...r, points: pts, startTransport });
  };

  const dragOrigin = useRef<Route | null>(null);
  const movePoint = (i: number, at: LngLat, commit: boolean) => {
    const r = projectRef.current.scenes[sceneIdx].route;
    if (!dragOrigin.current) dragOrigin.current = r;
    const pts = r.points.slice();
    pts[i] = { ...pts[i], at };
    if (commit) {
      const before = dragOrigin.current;
      dragOrigin.current = null;
      setHistory((h) => [...h.slice(-99), before]);
    }
    updateScene((s) => ({ ...s, route: { ...s.route, points: pts } }));
  };

  const patchPoint = (i: number, patch: Partial<Route["points"][number]>) => {
    const r = scene.route;
    setRoute({ ...r, points: r.points.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  };

  const pointTransport = (i: number): TransportId => {
    const leg = model?.legs.find((l) => l.p0 <= i && i < l.p1) ?? model?.legs[model.legs.length - 1];
    return leg?.transport ?? scene.route.startTransport;
  };

  const setTransportFrom = (i: number, tr: TransportId) => {
    const r = scene.route;
    if (i === 0) setRoute({ ...r, startTransport: tr, points: r.points.map((p, j) => (j === 0 ? { ...p, transport: undefined } : p)) });
    else patchPoint(i, { transport: tr });
  };

  const setLegTransport = (legIndex: number, tr: TransportId) => {
    const leg = model?.legs[legIndex];
    if (leg) setTransportFrom(leg.p0, tr);
  };

  const removePoint = (i: number) => {
    const r = scene.route;
    const pts = r.points.filter((_, j) => j !== i);
    // A removed leg start hands its transport to the next point, so later legs keep theirs.
    const removed = r.points[i];
    let startTransport = r.startTransport;
    if (removed?.transport) {
      if (i === 0) startTransport = removed.transport;
      else if (pts[i] && !pts[i].transport) pts[i] = { ...pts[i], transport: removed.transport };
    }
    if (i === 0 && pts[0]?.transport) {
      startTransport = pts[0].transport;
      pts[0] = { ...pts[0], transport: undefined };
    }
    setRoute({ ...r, points: pts, startTransport });
    setSelectedPoint(null);
  };

  const reverseRoute = () => {
    const r = scene.route;
    if (!model) return;
    const n = r.points.length;
    const rev = r.points
      .slice()
      .reverse()
      .map((p) => ({ at: p.at, ...(p.pause ? { pause: p.pause } : {}), ...(p.sharp ? { sharp: p.sharp } : {}) }) as Route["points"][number]);
    let startTransport = r.startTransport;
    for (const leg of model.legs) {
      const start = n - 1 - leg.p1;
      if (start === 0) startTransport = leg.transport;
      else rev[start] = { ...rev[start], transport: leg.transport };
    }
    setRoute({ ...r, points: rev, startTransport });
  };

  const importGpx = async (file: File) => {
    try {
      const pts = parseGpx(await file.text());
      setRoute({ kind: "gpx", points: pts.map((at) => ({ at })), smooth: false, startTransport: travelBy });
      setStep("route");
      setPreviewing(false);
      const b = boundsOf(pts);
      if (map && b) {
        map.fitBounds(b, { padding: Math.min(80, frame.w / 8), duration: 700, maxZoom: 13 });
        const cam = map.cameraForBounds(b, { padding: 40 });
        if (cam?.zoom !== undefined) {
          const z = Math.min(14, Math.round((cam.zoom + 2) * 10) / 10);
          updateScene((s) => ({ ...s, camera: { ...s.camera, zoom: z } }));
        }
      }
      setNotice(`Loaded ${pts.length.toLocaleString("en")} track points from ${file.name}.`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "The GPX file couldn't be read.");
    }
  };

  // ---- scenes
  const selectScene = (i: number) => {
    setPlaying(false);
    setPreviewing(false);
    setT(0);
    setHistory([]);
    setSelectedPoint(null);
    setSelectedSign(null);
    setSceneIdx(i);
  };
  const currentView = (): SavedView | null => {
    if (!map) return null;
    const c = map.getCenter();
    return { center: [c.lng, c.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
  };
  const addScene = () => {
    const s = newScene(`Scene ${project.scenes.length + 1}`, scene);
    s.view = currentView();
    s.route.startTransport = lastTransport;
    setProject((p) => ({ ...p, scenes: [...p.scenes, s] }));
    selectScene(project.scenes.length);
    setStep("route");
  };
  const duplicateScene = (i: number) => {
    const src = project.scenes[i];
    const copy: Scene = { ...structuredClone(src), id: uid(), name: `${src.name} (copy)`, signs: src.signs.map((x) => ({ ...x, id: uid() })) };
    setProject((p) => ({ ...p, scenes: [...p.scenes.slice(0, i + 1), copy, ...p.scenes.slice(i + 1)] }));
    selectScene(i + 1);
  };
  const moveScene = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    setProject((p) => {
      const sc = p.scenes.slice();
      [sc[i], sc[j]] = [sc[j], sc[i]];
      return { ...p, scenes: sc };
    });
    if (sceneIdx === i) setSceneIdx(j);
    else if (sceneIdx === j) setSceneIdx(i);
  };
  const deleteScene = (i: number) => {
    if (project.scenes.length < 2) return;
    if (!confirm(`Delete ${project.scenes[i].name}? This can't be undone.`)) return;
    setProject((p) => ({ ...p, scenes: p.scenes.filter((_, k) => k !== i) }));
    selectScene(Math.max(0, i <= sceneIdx ? sceneIdx - 1 : sceneIdx));
  };

  // ---- signs
  const placeSign = (at: LngLat) => {
    if (!placing) return;
    const id = uid();
    const defaults: Record<SignStyle, string> = { plate: "Place", tag: "Place", pin: "Place", flag: "Summit", caption: "Chapter one", photo: "" };
    updateScene((s) => ({
      ...s,
      signs: [...s.signs, { id, at, style: placing, text: defaults[placing], show: placing === "photo" || placing === "flag" ? "passed" : "always", pause: placing === "photo" ? 2 : 0 }],
    }));
    setSelectedSign(id);
    setPlacing(null);
  };
  const moveSign = (id: string, at: LngLat) => updateScene((s) => ({ ...s, signs: s.signs.map((x) => (x.id === id ? { ...x, at } : x)) }));

  // ---- files dropped on the page
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      setDragOver(true);
    };
    const leave = (e: DragEvent) => {
      if (e.relatedTarget === null) setDragOver(false);
    };
    const drop = async (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer?.files?.[0];
      if (!f) return;
      if (/\.gpx$/i.test(f.name)) importGpx(f);
      else if (/\.json$/i.test(f.name)) {
        try {
          const p = await importProjectFile(f);
          navigate(`/p/${p.id}`);
        } catch (err) {
          setNotice(err instanceof Error ? err.message : "That file couldn't be opened.");
        }
      } else setNotice("Drop a .gpx track or a .fardvag.json project file.");
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  });

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(id);
  }, [notice]);

  // ---- export
  const startRender = async () => {
    if (!map) return;
    setPlaying(false);
    const ac = new AbortController();
    abortRef.current = ac;
    if (render.status === "done") URL.revokeObjectURL(render.url);
    const scenes = project.output.joinScenes && project.scenes.length > 1 ? project.scenes.map((_, i) => i) : [sceneIdx];
    setRender({ status: "rendering", frame: 0, frames: 1, elapsedMs: 0, scene: 1, scenes: scenes.length, paused: false });
    let lock: WakeLockSentinel | null = null;
    try {
      lock = (await navigator.wakeLock?.request("screen").catch(() => null)) ?? null;
      const res = await renderVideo({
        map,
        project,
        scenes,
        models: project.scenes.map((s) => modelFor(s.route)),
        signal: ac.signal,
        onProgress: (p) => setRender({ status: "rendering", ...p }),
      });
      setRender({ status: "done", url: URL.createObjectURL(res.blob), blob: res.blob, width: res.width, height: res.height, codec: res.codec });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") setRender({ status: "idle" });
      else
        setRender({
          status: "error",
          message: err instanceof ExportUnsupportedError ? err.message : `Rendering stopped: ${err instanceof Error ? err.message : String(err)}`,
        });
    } finally {
      lock?.release().catch(() => {});
      abortRef.current = null;
    }
  };

  // ---- layout
  const stepIdx = STEPS.findIndex((s) => s.id === step);
  const goStep = (s: Step) => {
    setPlaying(false);
    setPreviewing(false);
    setPlacing(null);
    setSelectedPoint(null);
    setStep(s);
  };
  const interaction: Interaction = rendering || playing
    ? { kind: "none" }
    : mode === "route-edit"
      ? scene.route.kind === "drawn" && tool === "draw"
        ? { kind: "draw" }
        : { kind: "move" }
      : mode === "sign-edit"
        ? { kind: "signs", placing: !!placing }
        : { kind: "move" };

  const markers = useMemo(() => {
    const m: { t: number; kind: "pause" | "sign" }[] = [];
    let acc = timeline.holdStart;
    let prevU = 0;
    for (const p of timeline.pauses) {
      acc += p.u - prevU;
      m.push({ t: acc, kind: "pause" });
      acc += p.seconds;
      prevU = p.u;
    }
    for (const s of scene.signs) if (s.show === "passed" && timeline.signTimes[s.id] !== undefined) m.push({ t: timeline.signTimes[s.id], kind: "sign" });
    return m;
  }, [timeline, scene.signs]);

  return (
    <div className={`editor${dragOver ? " is-dragover" : ""}`}>
      <header className="topbar">
        <div className="topbar-project">
          <NassauLogo />
          <a className="back" href="#/">
            ← Projects
          </a>
          <input className="project-name" aria-label="Project name" value={project.name} onChange={(e) => updateProject((p) => ({ ...p, name: e.target.value }))} />
        </div>
        <SceneTabs
          scenes={project.scenes}
          current={sceneIdx}
          seconds={sceneSeconds}
          disabled={rendering}
          onSelect={selectScene}
          onAdd={addScene}
          onRename={(i, name) => setProject((p) => ({ ...p, scenes: p.scenes.map((s, k) => (k === i ? { ...s, name } : s)) }))}
          onDuplicate={duplicateScene}
          onMove={moveScene}
          onDelete={deleteScene}
        />
        <div className="topbar-end">
          <div className="menu-wrap">
            <button type="button" className="btn btn-secondary btn-small" aria-haspopup="menu" aria-expanded={projectMenu} onClick={() => setProjectMenu(!projectMenu)}>
              Project
            </button>
            {projectMenu && (
              <div className="menu menu-right" role="menu" onMouseLeave={() => setProjectMenu(false)}>
                <button type="button" role="menuitem" onClick={() => (setProjectMenu(false), downloadProjectFile(project))}>
                  Download project file
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={async () => {
                    setProjectMenu(false);
                    const copy = await duplicateProject(project);
                    navigate(`/p/${copy.id}`);
                  }}
                >
                  Duplicate project
                </button>
              </div>
            )}
          </div>
          <ThemeToggle />
        </div>
      </header>

      <nav className="steps" aria-label="Steps">
        {STEPS.map((s, i) => (
          <button key={s.id} type="button" className={`step${step === s.id ? " on" : ""}${i < stepIdx ? " past" : ""}`} aria-current={step === s.id ? "step" : undefined} disabled={rendering} onClick={() => goStep(s.id)}>
            <span className="step-num">{i + 1}</span>
            {s.label}
          </button>
        ))}
        <select
          className="aspect-select"
          aria-label="Video shape"
          value={project.output.aspect}
          disabled={rendering}
          onChange={(e) => updateProject((p) => ({ ...p, output: { ...p.output, aspect: e.target.value as Aspect } }))}
        >
          {(Object.keys(ASPECTS) as Aspect[]).map((a) => (
            <option key={a} value={a}>
              {ASPECTS[a].label}
            </option>
          ))}
        </select>
      </nav>

      <aside className="panel">
        <div className="panel-body">
          {step === "route" && (
            <RoutePanel
              scene={scene}
              travelBy={travelBy}
              setTravelBy={(tr) => {
                setTravelBy(tr);
                if (scene.route.kind === "gpx" || scene.route.points.length < 2) updateScene((s) => ({ ...s, route: { ...s.route, startTransport: tr } }));
              }}
              distanceKm={routeKm(scene.route)}
              canUndo={history.length > 0}
              onUndo={() => {
                const prev = history[history.length - 1];
                if (!prev) return;
                setHistory((h) => h.slice(0, -1));
                updateScene((s) => ({ ...s, route: prev }));
              }}
              onReverse={reverseRoute}
              onClear={() => setRoute({ kind: "drawn", points: [], smooth: true, startTransport: travelBy })}
              onSmooth={(v) => setRoute({ ...scene.route, smooth: v })}
              onImport={importGpx}
            />
          )}
          {step === "look" && <LookPanel scene={scene} model={model} update={updateScene} focusTransport={focusTransport} />}
          {step === "signs" && (
            <SignsPanel scene={scene} update={updateScene} placing={placing} setPlacing={setPlacing} selected={selectedSign} setSelected={setSelectedSign} onError={setNotice} />
          )}
          {step === "camera" && <CameraPanel scene={scene} update={updateScene} map={map} onShowView={(v) => map?.jumpTo(v)} />}
          {step === "export" && (
            <ExportPanel
              project={project}
              updateProject={updateProject}
              sceneSeconds={project.output.joinScenes ? sceneSeconds : [duration]}
              renderable={!!map && project.scenes.some((s) => modelFor(s.route))}
              render={render}
              onRender={startRender}
              onCancel={() => abortRef.current?.abort()}
              onDownload={() => render.status === "done" && downloadBlob(render.blob, `${slug(project.name)}-${render.height}p.mp4`)}
            />
          )}
        </div>
        {STEPS[stepIdx].next && (
          <footer className="panel-foot">
            <button type="button" className="btn btn-primary btn-wide" disabled={rendering} onClick={() => goStep(STEPS[stepIdx + 1].id)}>
              {STEPS[stepIdx].next}
            </button>
          </footer>
        )}
      </aside>

      <main className="stage">
        <div className="stage-area" ref={stageRef}>
          <div className={`frame${rendering ? " is-rendering" : ""}`} style={{ width: frame.w, height: frame.h }}>
            {frame.w > 0 && (
              <MapStage
                scene={scene}
                width={frame.w}
                height={frame.h}
                interaction={interaction}
                overlay={overlayRef}
                overlayKey={overlayKey}
                trackMoves={selectedPoint !== null}
                onReady={setMap}
                onAddPoint={addPoint}
                onMovePoint={movePoint}
                onPointClick={(i) => setSelectedPoint(i)}
                onToggleSharp={(i) => patchPoint(i, { sharp: !scene.route.points[i]?.sharp })}
                onPlaceSign={placeSign}
                onMoveSign={(id, at) => moveSign(id, at)}
                onSelectSign={setSelectedSign}
                onViewChange={(v) => {
                  if (mode !== "frame" && !rendering) updateScene((s) => ({ ...s, view: v }));
                }}
              >
                {(toScreen) =>
                  selectedPoint !== null && mode === "route-edit" && scene.route.points[selectedPoint] ? (
                    <PointPopover
                      scene={scene}
                      index={selectedPoint}
                      at={toScreen(model?.points[selectedPoint] ?? scene.route.points[selectedPoint].at)}
                      currentTransport={pointTransport(selectedPoint)}
                      onTransport={(tr) => setTransportFrom(selectedPoint, tr)}
                      onPause={(s) => patchPoint(selectedPoint, { pause: s || undefined })}
                      onSharp={(v) => patchPoint(selectedPoint, { sharp: v || undefined })}
                      onRemove={() => removePoint(selectedPoint)}
                      onClose={() => setSelectedPoint(null)}
                    />
                  ) : null
                }
              </MapStage>
            )}

            {mode === "route-edit" && !rendering && (
              <div className="map-toolbar">
                {scene.route.kind === "drawn" && (
                  <Segmented
                    label="Map tool"
                    value={tool}
                    options={[
                      { value: "draw", label: "Draw" },
                      { value: "move", label: "Move map" },
                    ]}
                    onChange={setTool}
                  />
                )}
                <button type="button" className="btn btn-small" disabled={!model} onClick={() => fitRoute(scene)}>
                  Show route
                </button>
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={!history.length}
                  onClick={() => {
                    const prev = history[history.length - 1];
                    setHistory((h) => h.slice(0, -1));
                    updateScene((s) => ({ ...s, route: prev }));
                  }}
                >
                  Undo
                </button>
              </div>
            )}
            {!rendering && (
              <div className="map-search">
                <SearchBox map={map} />
              </div>
            )}
            {(step === "route" || step === "look") && !playing && !rendering && (
              <LegsPanel
                scene={scene}
                model={model}
                onChange={setLegTransport}
                onStyle={(tr) => {
                  setFocusTransport(tr);
                  goStep("look");
                }}
              />
            )}
            {mode === "route-edit" && !rendering && scene.route.points.length === 0 && (
              <div className="getting-started">
                <strong>Start here</strong>
                <span>Search for a place, then click the map to drop the first point of your route. Or drop a GPX file on the page.</span>
              </div>
            )}
          </div>
          {dragOver && <div className="drop-veil">Drop a GPX track or a project file</div>}
        </div>

        <div className="timeline">
          <button type="button" className="play" onClick={togglePlay} disabled={!model || rendering} aria-label={playing ? "Pause" : "Play preview"}>
            {playing ? (
              <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden>
                <rect x="4" y="3" width="4" height="14" rx="1" fill="currentColor" />
                <rect x="12" y="3" width="4" height="14" rx="1" fill="currentColor" />
              </svg>
            ) : (
              <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden>
                <path d="M5 3.5v13a1 1 0 0 0 1.5.86l11-6.5a1 1 0 0 0 0-1.72l-11-6.5A1 1 0 0 0 5 3.5Z" fill="currentColor" />
              </svg>
            )}
          </button>
          <span className="time">
            {fmtTime(Math.min(t, duration))} <span className="time-total">/ {fmtTime(duration)}</span>
          </span>
          <div className="scrub-wrap">
            <input
              className="scrub"
              type="range"
              aria-label="Playhead"
              min={0}
              max={duration}
              step={0.01}
              value={Math.min(t, duration)}
              disabled={!model || rendering}
              onChange={(e) => {
                setPlaying(false);
                setPreviewing(true);
                setSelectedPoint(null);
                setT(parseFloat(e.target.value));
              }}
            />
            <div className="scrub-marks" aria-hidden>
              {markers.map((m, i) => (
                <span key={i} className={`mark mark-${m.kind}`} style={{ left: `${(100 * m.t) / Math.max(0.01, duration)}%` }} />
              ))}
            </div>
          </div>
          {(previewing || playing) && (step === "route" || step === "signs") && !rendering && (
            <button
              type="button"
              className="btn btn-small"
              onClick={() => {
                setPlaying(false);
                setPreviewing(false);
              }}
            >
              Back to editing
            </button>
          )}
        </div>
      </main>

      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
    </div>
  );
}
