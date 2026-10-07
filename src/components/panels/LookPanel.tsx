import { useEffect, useState } from "react";
import { ColorPicker, Field, Fold, Segmented, Slider, Toggle } from "../Controls";
import { THEMES } from "../../lib/mapScene";
import type { RouteModel } from "../../lib/model";
import { TRANSPORT_IDS, TRANSPORTS, transportIcon } from "../../lib/transports";
import type { Corner, Scene, TransportId, TransportStyle } from "../../lib/types";

export function LookPanel(props: {
  scene: Scene;
  model: RouteModel | null;
  update: (fn: (s: Scene) => Scene) => void;
  focusTransport: TransportId | null;
}) {
  const { scene, update } = props;
  const look = scene.look;
  const used = [...new Set(props.model?.legs.map((l) => l.transport) ?? [scene.route.startTransport])];
  const [picked, setPicked] = useState<TransportId>(props.focusTransport ?? used[0] ?? "car");
  useEffect(() => {
    if (props.focusTransport) setPicked(props.focusTransport);
  }, [props.focusTransport]);
  const style = look.transports[picked];
  const legCount = (id: TransportId) => props.model?.legs.filter((l) => l.transport === id).length ?? 0;

  const setLook = (l: Partial<Scene["look"]>) => update((s) => ({ ...s, look: { ...s.look, ...l } }));
  const setStyle = (st: Partial<TransportStyle>) =>
    update((s) => ({ ...s, look: { ...s.look, transports: { ...s.look.transports, [picked]: { ...s.look.transports[picked], ...st } } } }));
  const setCompass = (c: Partial<Scene["look"]["compass"]>) => setLook({ compass: { ...look.compass, ...c } });

  const others = TRANSPORT_IDS.filter((id) => !used.includes(id));

  return (
    <>
      <header className="panel-intro">
        <h2>Choose the look</h2>
        <p>The map, the line and its symbol, and extras like a compass. This is per scene; a new scene copies the look of the last one.</p>
      </header>

      <Fold title="Map">
        <div className="themes" role="radiogroup" aria-label="Map theme">
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={look.theme === t.id}
              className={`theme${look.theme === t.id ? " on" : ""}`}
              onClick={() => setLook({ theme: t.id })}
            >
              <span className="theme-swatch" style={{ background: t.swatch[0] }} aria-hidden>
                <span style={{ background: t.swatch[1] }} />
                <span style={{ background: t.swatch[2] }} />
              </span>
              {t.label}
            </button>
          ))}
        </div>
        <Toggle label="3D mountains" hint="Raises the terrain. Pair it with some tilt in the camera step." checked={look.terrain} onChange={(v) => setLook({ terrain: v })} />
        <Toggle label="Place names" checked={look.placeNames} onChange={(v) => setLook({ placeNames: v })} />
      </Fold>

      <Fold title="Line and symbol">
        <Field label="Transport styles">
          <div className="transports" role="radiogroup" aria-label="Transport to style">
            {[...used, ...others].map((id) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={picked === id}
                className={`transport${picked === id ? " on" : ""}${used.includes(id) ? "" : " unused"}`}
                onClick={() => setPicked(id)}
              >
                <img src={transportIcon(id, look.transports[id].color, 28)} alt="" width={22} height={22} />
                <span>
                  {TRANSPORTS[id].label}
                  {legCount(id) > 0 && <small>{legCount(id) === 1 ? "1 leg" : `${legCount(id)} legs`}</small>}
                </span>
              </button>
            ))}
          </div>
        </Field>
        <div className="style-card">
          <p className="style-card-title">
            {TRANSPORTS[picked].label} style
            <small>{legCount(picked) ? `Changes ${legCount(picked) === 1 ? "the" : "every"} ${TRANSPORTS[picked].label.toLowerCase()} leg` : "Not used in this route yet"}</small>
          </p>
          <Field label="Colour">
            <ColorPicker label="Line colour" value={style.color} onChange={(c) => setStyle({ color: c })} />
          </Field>
          <Slider label="Thickness" value={style.width} min={2} max={14} step={1} format={(v) => `${v} px`} onChange={(v) => setStyle({ width: v })} />
          <Field label="Line">
            <Segmented
              label="Line pattern"
              value={style.line}
              options={[
                { value: "solid", label: "Solid" },
                { value: "dashed", label: "Dashed" },
                { value: "dotted", label: "Dotted" },
              ]}
              onChange={(v) => setStyle({ line: v })}
            />
          </Field>
          <Field label="Symbol at the tip">
            <Segmented
              label="Symbol at the tip"
              value={style.symbol}
              options={[
                { value: "badge", label: TRANSPORTS[picked].label },
                { value: "arrow", label: "Arrow" },
                { value: "dot", label: "Dot" },
                { value: "none", label: "None" },
              ]}
              onChange={(v) => setStyle({ symbol: v })}
            />
          </Field>
          {style.symbol !== "none" && (
            <Field label="Symbol colour">
              <Segmented
                label="Symbol colour"
                value={style.symbolColor ? "own" : "line"}
                options={[
                  { value: "line", label: "Same as line" },
                  { value: "own", label: "Its own" },
                ]}
                onChange={(v) => setStyle({ symbolColor: v === "own" ? "#E6E6E6" : null })}
              />
              {style.symbolColor && (
                <div className="nested">
                  <ColorPicker label="Symbol colour" value={style.symbolColor} onChange={(c) => setStyle({ symbolColor: c })} />
                </div>
              )}
            </Field>
          )}
        </div>
        <Slider label="Symbol size" value={look.symbolScale} min={0.6} max={2} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setLook({ symbolScale: v })} />
        <Toggle label="White outline" hint="A thin white edge around the line." checked={look.outline} onChange={(v) => setLook({ outline: v })} />
        <Toggle label="Show the way ahead" hint="A faint dashed line for the part not travelled yet." checked={look.showAhead} onChange={(v) => setLook({ showAhead: v })} />
      </Fold>

      <Fold title="Extras" defaultOpen={look.compass.on}>
        <Toggle label="Compass" hint="Sits in a corner of the video and turns with the map." checked={look.compass.on} onChange={(v) => setCompass({ on: v })} />
        {look.compass.on && (
          <>
            <Field label="Corner">
              <Segmented<Corner>
                label="Compass corner"
                value={look.compass.corner}
                options={[
                  { value: "tl", label: "Top left" },
                  { value: "tr", label: "Top right" },
                  { value: "bl", label: "Bottom left" },
                  { value: "br", label: "Bottom right" },
                ]}
                onChange={(v) => setCompass({ corner: v })}
              />
            </Field>
            <Field label="Style">
              <Segmented
                label="Compass style"
                value={look.compass.style}
                options={[
                  { value: "needle", label: "Needle" },
                  { value: "rose", label: "Compass rose" },
                ]}
                onChange={(v) => setCompass({ style: v })}
              />
            </Field>
            <Slider label="Size" value={look.compass.size} min={0.6} max={2} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setCompass({ size: v })} />
          </>
        )}
      </Fold>
    </>
  );
}
