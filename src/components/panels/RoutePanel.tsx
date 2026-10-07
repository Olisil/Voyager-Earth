import { Section, Toggle } from "../Controls";
import { TRANSPORT_IDS, TRANSPORTS, transportIcon } from "../../lib/transports";
import type { Scene, TransportId } from "../../lib/types";

export function TransportPicker(props: {
  value: TransportId;
  onChange: (t: TransportId) => void;
  scene: Scene;
  label: string;
}) {
  return (
    <div className="transports" role="radiogroup" aria-label={props.label}>
      {TRANSPORT_IDS.map((id) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={props.value === id}
          className={`transport${props.value === id ? " on" : ""}`}
          onClick={() => props.onChange(id)}
        >
          <img src={transportIcon(id, props.scene.look.transports[id].color, 28)} alt="" width={22} height={22} />
          {TRANSPORTS[id].label}
        </button>
      ))}
    </div>
  );
}

export function RoutePanel(props: {
  scene: Scene;
  travelBy: TransportId;
  setTravelBy: (t: TransportId) => void;
  distanceKm: number;
  canUndo: boolean;
  onUndo: () => void;
  onReverse: () => void;
  onClear: () => void;
  onSmooth: (v: boolean) => void;
  onImport: (f: File) => void;
}) {
  const { scene } = props;
  const isGpx = scene.route.kind === "gpx";
  const n = scene.route.points.length;
  return (
    <>
      <header className="panel-intro">
        <h2>Make the route</h2>
        <p>This is the line your video will draw.</p>
      </header>

      <div className="source-cards">
        <div className={`source-card${!isGpx ? " on" : ""}`}>
          <span className="source-title">Draw it</span>
          <span className="source-hint">Click on the map to place points</span>
        </div>
        <label className={`source-card${isGpx ? " on" : ""}`}>
          <input
            type="file"
            accept=".gpx,application/gpx+xml"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) props.onImport(f);
              e.target.value = "";
            }}
          />
          <span className="source-title">Use a GPX file</span>
          <span className="source-hint">A recording from a watch, bike computer or phone</span>
        </label>
      </div>

      <dl className="stats">
        <div>
          <dt>{isGpx ? "Track points" : "Points"}</dt>
          <dd>{n.toLocaleString("en")}</dd>
        </div>
        <div>
          <dt>Distance</dt>
          <dd>{props.distanceKm < 10 ? props.distanceKm.toFixed(1) : Math.round(props.distanceKm).toLocaleString("en")} km</dd>
        </div>
      </dl>

      <div className="button-row">
        <button type="button" className="btn" onClick={props.onReverse} disabled={n < 2}>
          Reverse route
        </button>
        <button type="button" className="btn" onClick={props.onUndo} disabled={!props.canUndo}>
          Undo
        </button>
        <button type="button" className="btn btn-quiet" onClick={props.onClear} disabled={n === 0}>
          Clear route
        </button>
      </div>
      <Toggle label="Smooth curves" hint="Rounds the corners between points." checked={scene.route.smooth} onChange={props.onSmooth} />

      <Section title={isGpx ? "Travelling by" : "Next points travel by"} hint={isGpx ? "How the whole track travels." : "Points you add from now on use this. Change an existing leg in the Legs list on the map."}>
        <TransportPicker scene={scene} label="Travelling by" value={props.travelBy} onChange={props.setTravelBy} />
      </Section>

      <details className="fold">
        <summary>
          <span>How to draw</span>
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden>
            <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </summary>
        <ul className="tips">
          <li>Click the map to add a point at the end of the route. Drag on the map to pan.</li>
          <li>Drag a point to move it. Click a point to change transport from there, add a pause, or remove it.</li>
          <li>Double-click a point to give it a sharp corner when curves are smoothed.</li>
          <li>Search for a place with the magnifier, or press /.</li>
          <li>Drop a GPX file anywhere on the page to use a recorded track.</li>
        </ul>
      </details>
    </>
  );
}
