import type { Map as MLMap } from "maplibre-gl";
import { Field, Section, Segmented, Slider, Toggle } from "../Controls";
import type { SavedView, Scene } from "../../lib/types";

function viewOf(map: MLMap): SavedView {
  const c = map.getCenter();
  return { center: [c.lng, c.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
}

export function CameraPanel(props: { scene: Scene; update: (fn: (s: Scene) => Scene) => void; map: MLMap | null; onShowView: (v: SavedView) => void }) {
  const { scene, update, map } = props;
  const cam = scene.camera;
  const set = (c: Partial<Scene["camera"]>) => update((s) => ({ ...s, camera: { ...s.camera, ...c } }));
  const setTiming = (c: Partial<Scene["timing"]>) => update((s) => ({ ...s, timing: { ...s.timing, ...c } }));

  const viewButtons = (key: "fixedView" | "startView" | "endView", label: string) => (
    <div className="view-row">
      <span className="view-label">{label}</span>
      <button type="button" className="btn btn-small" disabled={!map} onClick={() => map && set({ [key]: viewOf(map) })}>
        {cam[key] ? "Update to this view" : "Use this view"}
      </button>
      {cam[key] && (
        <button type="button" className="btn btn-small btn-quiet" onClick={() => props.onShowView(cam[key]!)}>
          Show
        </button>
      )}
    </div>
  );

  return (
    <>
      <header className="panel-intro">
        <h2>Set up the camera</h2>
        <p>
          {cam.mode === "follow"
            ? "The camera stays with the tip of the line as it travels."
            : cam.mode === "glide"
              ? "The camera glides from one view to another while the line draws."
              : "The camera films one view while the line draws."}
        </p>
      </header>

      <Section title="Camera movement">
        <Segmented
          stacked
          label="Camera movement"
          value={cam.mode}
          options={[
            { value: "fixed", label: "Fixed view", hint: "Films exactly what you see" },
            { value: "glide", label: "Start to end", hint: "Glide from one view to another" },
            { value: "follow", label: "Follow the line", hint: "Stay with the symbol as it travels" },
          ]}
          onChange={(v) => set({ mode: v })}
        />
      </Section>

      {cam.mode === "fixed" && (
        <Section title="Framing" hint="Move and zoom the map until it shows what you want, then save the view. Without one, the map stays wherever you leave it.">
          {viewButtons("fixedView", "View")}
        </Section>
      )}

      {cam.mode === "glide" && (
        <Section title="Framing" hint="Frame the map for the first moment, save it as the start, then do the same for the end. A missing view shows the whole route.">
          {viewButtons("startView", "Start")}
          {viewButtons("endView", "End")}
        </Section>
      )}

      {cam.mode === "follow" && (
        <Section title="Framing">
          <Slider label="Zoom" value={cam.zoom} min={3} max={16} step={0.1} format={(v) => v.toFixed(1)} ends={["Wide", "Close"]} onChange={(v) => set({ zoom: v })} />
          <button
            type="button"
            className="btn btn-link"
            disabled={!map}
            onClick={() => map && set({ zoom: Math.round(map.getZoom() * 10) / 10, pitch: Math.round(map.getPitch()) })}
          >
            Use the map's current zoom and tilt
          </button>
          <Toggle label="Open on the whole route" hint="Starts on the full trip and glides in to the line." checked={cam.openWide} onChange={(v) => set({ openWide: v })} />
          <Toggle label="End on the whole route" hint="Pulls back to the full trip at the end." checked={cam.closeWide} onChange={(v) => set({ closeWide: v })} />
          <Field label="Which way is up">
            <Segmented
              stacked
              label="Which way is up"
              value={cam.up}
              options={[
                { value: "north", label: "North up", hint: "The map stays still, the symbol turns" },
                { value: "travel", label: "Direction of travel", hint: "The map turns, the line heads up" },
              ]}
              onChange={(v) => set({ up: v })}
            />
          </Field>
          <Field label="Look ahead">
            <Segmented
              label="Look ahead"
              value={cam.lookAhead}
              options={[
                { value: 0, label: "Tip centred" },
                { value: 0.15, label: "A little" },
                { value: 0.3, label: "More" },
              ]}
              onChange={(v) => set({ lookAhead: v })}
            />
          </Field>
          <Field label="Camera steadiness">
            <Segmented
              label="Camera steadiness"
              value={cam.steadiness}
              options={[
                { value: "tight", label: "Tight" },
                { value: "smooth", label: "Smooth" },
                { value: "very", label: "Very smooth" },
              ]}
              onChange={(v) => set({ steadiness: v })}
            />
          </Field>
          <Slider label="Tilt" value={cam.pitch} min={0} max={65} step={1} format={(v) => `${v}°`} ends={["Flat", "Flyover"]} onChange={(v) => set({ pitch: v })} />
        </Section>
      )}

      <Section title="Timing" hint="Legs share this time by distance and speed: walking is slower than driving, flights are faster.">
        <Slider label="Line travel time" value={scene.timing.duration} min={3} max={90} step={0.5} format={(v) => `${v} s`} onChange={(v) => setTiming({ duration: v })} />
        <Segmented
          label="Speed"
          value={scene.timing.easing}
          options={[
            { value: "ease", label: "Ease in and out" },
            { value: "steady", label: "Steady" },
          ]}
          onChange={(v) => setTiming({ easing: v })}
        />
      </Section>
    </>
  );
}
