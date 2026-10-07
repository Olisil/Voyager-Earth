import { useEffect, useState } from "react";
import { deleteProject, downloadProjectFile, duplicateProject, importProjectFile, listProjects, saveProject } from "../lib/db";
import { toXY, unwrap } from "../lib/geo";
import { navigate } from "../router";
import { NassauLogo, ThemeToggle } from "../theme";
import { demoProject, newProject, type Project } from "../lib/types";

function ago(ts: number) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** The first scene's route, drawn as a small line in its leg colours. */
function RouteThumb({ project }: { project: Project }) {
  const scene = project.scenes.find((s) => s.route.points.length > 1);
  if (!scene) return <div className="thumb thumb-empty">No route yet</div>;
  const pts = unwrap(scene.route.points.map((p) => p.at)).map(toXY);
  let [x0, y0] = pts[0];
  let [x1, y1] = pts[0];
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  const W = 320;
  const H = 180;
  const s = Math.min((W - 40) / Math.max(x1 - x0, 1e-9), (H - 40) / Math.max(y1 - y0, 1e-9));
  const ox = (W - (x1 - x0) * s) / 2;
  const oy = (H - (y1 - y0) * s) / 2;
  const step = Math.max(1, Math.floor(pts.length / 600));
  const d = pts
    .filter((_, i) => i % step === 0 || i === pts.length - 1)
    .map(([x, y], i) => `${i ? "L" : "M"}${(ox + (x - x0) * s).toFixed(1)} ${(oy + (y - y0) * s).toFixed(1)}`)
    .join(" ");
  const color = scene.look.transports[scene.route.startTransport].color;
  const [ex, ey] = pts[pts.length - 1];
  return (
    <svg className="thumb" viewBox={`0 0 ${W} ${H}`} aria-hidden>
      <path d={d} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={ox + (ex - x0) * s} cy={oy + (ey - y0) * s} r="5" fill={color} />
    </svg>
  );
}

export function Home() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const refresh = () =>
    listProjects()
      .then(setProjects)
      .catch(() => {
        setProjects([]);
        setError("This browser won't let the app save projects. Private windows often block it; try a normal window.");
      });
  useEffect(() => {
    refresh();
  }, []);

  const create = async (demo = false) => {
    const p = demo ? demoProject() : newProject();
    await saveProject(p);
    navigate(`/p/${p.id}`);
  };
  const open = async (f: File) => {
    try {
      const p = await importProjectFile(f);
      navigate(`/p/${p.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That file couldn't be opened.");
    }
  };

  useEffect(() => {
    const over = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      setDragOver(true);
    };
    const leave = (e: DragEvent) => e.relatedTarget === null && setDragOver(false);
    const drop = (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer?.files?.[0];
      if (f) open(f);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, []);

  return (
    <div className="home">
      <header className="header">
        <NassauLogo />
        <span className="header-app">Färdväg</span>
        <span className="header-spacer" />
        <ThemeToggle />
      </header>

      <main className="home-main">
        <section className="home-hero">
          <h1>Animated route maps</h1>
          <p className="lead">Draw your trip or drop in a GPX file, add signs and a camera move, and render an MP4 for your film, up to 4K.</p>
          <div className="button-group">
            <button type="button" className="btn btn-primary" onClick={() => create()}>
              Create project
            </button>
            <label className="btn btn-secondary">
              Open a project file
              <input
                type="file"
                accept=".json,application/json"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) open(f);
                }}
              />
            </label>
          </div>
          <p className="hint">Free, no account. Projects are saved in this browser; download a project file to move one to another computer.</p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </section>

        <section className="home-projects" aria-labelledby="projects-title">
          <div className="home-projects-head">
            <h2 id="projects-title">Your projects</h2>
            {projects && projects.length > 0 && (
              <span className="pill">
                {projects.length} {projects.length === 1 ? "project" : "projects"}
              </span>
            )}
          </div>
          {projects === null ? null : projects.length === 0 ? (
            <div className="empty">
              <p>No projects yet. Create one, open a project file, or start from an example trip.</p>
              <button type="button" className="btn" onClick={() => create(true)}>
                Open the example
              </button>
            </div>
          ) : (
            <ul className="cards">
              {projects.map((p) => (
                <li key={p.id} className="card">
                  <a className="card-open" href={`#/p/${p.id}`}>
                    <RouteThumb project={p} />
                    <span className="card-name">{p.name || "Untitled trip"}</span>
                  </a>
                  <div className="card-meta">
                    <span className="pill">
                      {p.scenes.length} {p.scenes.length === 1 ? "scene" : "scenes"}
                    </span>
                    <span className="pill">{p.output.aspect}</span>
                    <span className="card-time">Edited {ago(p.updatedAt)}</span>
                  </div>
                  <div className="card-actions">
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={async () => {
                        await duplicateProject(p);
                        refresh();
                      }}
                    >
                      Duplicate
                    </button>
                    <button type="button" className="btn btn-small" onClick={() => downloadProjectFile(p)}>
                      Download file
                    </button>
                    <button
                      type="button"
                      className="btn btn-small btn-quiet btn-danger"
                      onClick={async () => {
                        if (!confirm(`Delete ${p.name}? It's removed from this browser. Download the project file first if you want to keep it.`)) return;
                        await deleteProject(p.id);
                        refresh();
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      <footer className="home-foot">
        <span>Maps © OpenStreetMap contributors, OpenMapTiles, OpenFreeMap</span>
        <a href="/">nassau.se</a>
      </footer>
      {dragOver && <div className="drop-veil">Drop a project file to open it</div>}
    </div>
  );
}
