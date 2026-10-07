import { useEffect, useRef } from "react";
import { Segmented, Slider } from "../Controls";
import { photoToDataUrl } from "../../lib/overlay";
import type { Scene, Sign, SignStyle } from "../../lib/types";

export const SIGN_STYLES: { id: SignStyle; label: string; hint: string }[] = [
  { id: "plate", label: "Plate", hint: "Dark board on a post" },
  { id: "tag", label: "Tag", hint: "White card with a pointer" },
  { id: "pin", label: "Pin", hint: "A dot with a name" },
  { id: "flag", label: "Flag", hint: "For summits and arrivals" },
  { id: "caption", label: "Caption", hint: "Big title text" },
  { id: "photo", label: "Photo", hint: "An instant print" },
];

const PAUSES = [0, 1, 2, 3, 5];

export function SignsPanel(props: {
  scene: Scene;
  update: (fn: (s: Scene) => Scene) => void;
  placing: SignStyle | null;
  setPlacing: (s: SignStyle | null) => void;
  selected: string | null;
  setSelected: (id: string | null) => void;
  onError: (msg: string) => void;
}) {
  const { scene, update } = props;
  const setSign = (id: string, patch: Partial<Sign>) =>
    update((s) => ({ ...s, signs: s.signs.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
  const remove = (id: string) => {
    update((s) => ({ ...s, signs: s.signs.filter((x) => x.id !== id) }));
    props.setSelected(null);
  };
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (!props.selected) return;
    const el = listRef.current?.querySelector<HTMLInputElement>(`[data-sign="${props.selected}"] input[type=text]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [props.selected]);

  return (
    <>
      <header className="panel-intro">
        <h2>Add signs</h2>
        <p>Pick a style, click the map where it goes, then type its text.</p>
      </header>

      <div className="sign-styles" role="radiogroup" aria-label="Sign style to add">
        {SIGN_STYLES.map((s) => (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={props.placing === s.id}
            className={`sign-style sign-style-${s.id}${props.placing === s.id ? " on" : ""}`}
            onClick={() => props.setPlacing(props.placing === s.id ? null : s.id)}
          >
            <span className="sign-sample" aria-hidden>
              {s.id === "photo" ? "" : s.label}
            </span>
            <span className="sign-hint">{s.hint}</span>
          </button>
        ))}
      </div>
      {props.placing && <p className="hint hint-live">Click the map where the sign goes. Press Esc to stop.</p>}

      <Slider label="Sign size" value={scene.signScale} min={0.6} max={2} step={0.05} format={(v) => `${Math.round(v * 100)}%`} ends={["Smaller", "Bigger"]} onChange={(v) => update((s) => ({ ...s, signScale: v }))} />

      <h3 className="section-title">On the map</h3>
      {scene.signs.length === 0 ? (
        <p className="hint">No signs yet. Pick a style above, then click the map.</p>
      ) : (
        <ol className="sign-list" ref={listRef}>
          {scene.signs.map((sign, i) => {
            const open = props.selected === sign.id;
            return (
              <li key={sign.id} data-sign={sign.id} className={open ? "open" : ""}>
                <button type="button" className="sign-row" onClick={() => props.setSelected(open ? null : sign.id)} aria-expanded={open}>
                  <span className="sign-num">{i + 1}</span>
                  <span className="sign-name">{sign.text || "Untitled"}</span>
                  <span className="sign-meta">
                    {SIGN_STYLES.find((s) => s.id === sign.style)?.label}, {sign.show === "always" ? "always" : "when passed"}
                    {sign.pause ? `, pause ${sign.pause} s` : ""}
                  </span>
                </button>
                {open && (
                  <div className="sign-edit">
                    <input
                      type="text"
                      className="input"
                      aria-label="Sign text"
                      value={sign.text}
                      placeholder={sign.style === "photo" ? "Caption (optional)" : "Text"}
                      onChange={(e) => setSign(sign.id, { text: e.target.value })}
                    />
                    {sign.style === "photo" && (
                      <label className="btn">
                        {sign.photo ? "Change photo" : "Choose photo"}
                        <input
                          type="file"
                          accept="image/*"
                          hidden
                          onChange={async (e) => {
                            const f = e.target.files?.[0];
                            e.target.value = "";
                            if (!f) return;
                            try {
                              setSign(sign.id, { photo: await photoToDataUrl(f) });
                            } catch {
                              props.onError("That image couldn't be opened. Try a JPEG or PNG.");
                            }
                          }}
                        />
                      </label>
                    )}
                    <Segmented
                      label="Style"
                      value={sign.style}
                      options={SIGN_STYLES.map((s) => ({ value: s.id, label: s.label }))}
                      onChange={(v) => setSign(sign.id, { style: v })}
                    />
                    <Segmented
                      label="When it shows"
                      value={sign.show}
                      options={[
                        { value: "always", label: "Always" },
                        { value: "passed", label: "When passed" },
                      ]}
                      onChange={(v) => setSign(sign.id, { show: v })}
                    />
                    <div className="field-label">Stop the line here</div>
                    <Segmented
                      label="Pause at this sign"
                      value={sign.pause}
                      options={PAUSES.map((p) => ({ value: p, label: p ? `${p} s` : "No" }))}
                      onChange={(v) => setSign(sign.id, { pause: v })}
                    />
                    <button type="button" className="btn btn-quiet btn-danger" onClick={() => remove(sign.id)}>
                      Remove sign
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
      <p className="hint">Drag a sign on the map to move it. Signs set to "when passed" pop up as the line reaches them.</p>
    </>
  );
}
