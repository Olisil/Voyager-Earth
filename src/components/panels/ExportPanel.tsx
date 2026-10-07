import { Field, Segmented, Toggle } from "../Controls";
import { outputSize, RESOLUTIONS, type Project } from "../../lib/types";

export type RenderState =
  | { status: "idle" }
  | { status: "rendering"; frame: number; frames: number; elapsedMs: number; scene: number; scenes: number; paused: boolean }
  | { status: "done"; url: string; blob: Blob; width: number; height: number; codec: string }
  | { status: "error"; message: string };

function clock(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function ExportPanel(props: {
  project: Project;
  updateProject: (fn: (p: Project) => Project) => void;
  sceneSeconds: number[];
  renderable: boolean;
  render: RenderState;
  onRender: () => void;
  onCancel: () => void;
  onDownload: () => void;
}) {
  const { project, render } = props;
  const out = project.output;
  const set = (o: Partial<Project["output"]>) => props.updateProject((p) => ({ ...p, output: { ...p.output, ...o } }));
  const size = outputSize(out.aspect, out.resolution);
  const many = project.scenes.length > 1;
  const join = many && out.joinScenes;
  const seconds = join ? props.sceneSeconds.reduce((a, b) => a + b, 0) : (props.sceneSeconds[0] ?? 0);
  const frames = Math.round(seconds * out.fps);
  const busy = render.status === "rendering";

  return (
    <>
      <header className="panel-intro">
        <h2>Preview & export</h2>
        <p>Nothing is rendered until you press Render.</p>
      </header>

      {many && (
        <Toggle
          label="All scenes in one video"
          hint={`The ${project.scenes.length} scenes one after another, cut straight from one to the next. Off renders the scene you're on.`}
          checked={out.joinScenes}
          disabled={busy}
          onChange={(v) => set({ joinScenes: v })}
        />
      )}

      <Field label="Still at start">
        <Segmented
          label="Still at start"
          value={out.holdStart}
          disabled={busy}
          options={[0, 0.5, 1, 2, 3].map((v) => ({ value: v, label: v ? `${v} s` : "None" }))}
          onChange={(v) => set({ holdStart: v })}
        />
      </Field>
      <Field label="Still at end">
        <Segmented
          label="Still at end"
          value={out.holdEnd}
          disabled={busy}
          options={[0, 0.5, 1, 1.5, 2, 3].map((v) => ({ value: v, label: v ? `${v} s` : "None" }))}
          onChange={(v) => set({ holdEnd: v })}
        />
      </Field>
      <Field label="Resolution">
        <Segmented
          label="Resolution"
          value={out.resolution}
          disabled={busy}
          options={RESOLUTIONS.map((r) => ({ value: r.value, label: r.label }))}
          onChange={(v) => set({ resolution: v })}
        />
      </Field>
      <Field label="Frame rate">
        <Segmented
          label="Frame rate"
          value={out.fps}
          disabled={busy}
          options={([24, 25, 30, 60] as const).map((v) => ({ value: v, label: `${v} fps` }))}
          onChange={(v) => set({ fps: v })}
        />
      </Field>
      <Toggle
        label="Map credit in the corner"
        hint="OpenStreetMap's licence asks for credit wherever the map is shown. Turn it off only if you credit it elsewhere."
        checked={out.credit}
        disabled={busy}
        onChange={(v) => set({ credit: v })}
      />
      <p className="hint">Resolution, frame rate, video shape and the stills apply to the whole project.</p>

      <div className="render">
        <p className="render-summary">
          {join ? `${project.scenes.length} scenes, ` : ""}
          {size.width} × {size.height}, {seconds.toFixed(1)} s, {frames.toLocaleString("en")} frames
        </p>
        {render.status === "rendering" ? (
          <>
            <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={render.frames} aria-valuenow={render.frame}>
              <span style={{ width: `${(100 * render.frame) / Math.max(1, render.frames)}%` }} />
            </div>
            <p className="hint" aria-live="polite">
              {render.paused
                ? "Paused while this tab is in the background. Come back to it to carry on."
                : `${render.scenes > 1 ? `Scene ${render.scene} of ${render.scenes}. ` : ""}Frame ${render.frame.toLocaleString("en")} of ${render.frames.toLocaleString("en")}${
                    render.frame > 5 ? `, about ${clock((render.elapsedMs / render.frame) * (render.frames - render.frame))} left` : ""
                  }.`}
            </p>
            <button type="button" className="btn" onClick={props.onCancel}>
              Stop rendering
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-primary btn-big" onClick={props.onRender} disabled={!props.renderable}>
            Render video
          </button>
        )}
        {!props.renderable && render.status !== "rendering" && <p className="hint">Draw a route with at least two points first.</p>}
        {render.status === "error" && (
          <p className="error" role="alert">
            {render.message}
          </p>
        )}
        {render.status === "done" && (
          <div className="result">
            <video src={render.url} controls playsInline muted />
            {render.codec !== "avc" && (
              <p className="hint">
                This browser can't make H.264, so the video uses {render.codec.toUpperCase()}. Some editors won't open it; render in Chrome or Edge for the most compatible file.
              </p>
            )}
            <button type="button" className="btn btn-primary" onClick={props.onDownload}>
              Download MP4
            </button>
          </div>
        )}
      </div>
    </>
  );
}
