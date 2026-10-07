import { useEffect, useRef, useState } from "react";
import type { Scene } from "../lib/types";

export function SceneTabs(props: {
  scenes: Scene[];
  current: number;
  seconds: number[];
  disabled: boolean;
  onSelect: (i: number) => void;
  onAdd: () => void;
  onRename: (i: number, name: string) => void;
  onDuplicate: (i: number) => void;
  onMove: (i: number, dir: -1 | 1) => void;
  onDelete: (i: number) => void;
}) {
  const [menu, setMenu] = useState<number | null>(null);
  const [menuAt, setMenuAt] = useState({ x: 0, y: 0 });
  const [renaming, setRenaming] = useState<number | null>(null);
  const strip = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (menu === null) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (e instanceof MouseEvent && (e.target as HTMLElement).closest(".scene-menu")) return;
      setMenu(null);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [menu]);

  useEffect(() => {
    strip.current?.querySelector(".scene-tab.on")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [props.current]);

  return (
    <div className="scenes" aria-label="Scenes">
      <div
        className="scene-strip"
        ref={strip}
        onWheel={(e) => {
          if (strip.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) strip.current.scrollLeft += e.deltaY;
        }}
      >
        {props.scenes.map((s, i) => (
          <div key={s.id} className={`scene-tab${i === props.current ? " on" : ""}`}>
            {renaming === i ? (
              <input
                className="scene-rename"
                autoFocus
                defaultValue={s.name}
                aria-label="Scene name"
                onBlur={(e) => {
                  props.onRename(i, e.target.value.trim() || s.name);
                  setRenaming(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") setRenaming(null);
                }}
              />
            ) : (
              <button type="button" className="scene-pick" disabled={props.disabled} onClick={() => props.onSelect(i)} onDoubleClick={() => setRenaming(i)}>
                <span className="scene-num">{i + 1}</span>
                <span className="scene-name">{s.name}</span>
                <span className="scene-dur">{props.seconds[i]?.toFixed(1)} s</span>
              </button>
            )}
            <button type="button" className="scene-more" aria-label={`More for ${s.name}`} aria-haspopup="menu" disabled={props.disabled} onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setMenuAt({ x: r.left, y: r.bottom + 4 });
                setMenu(menu === i ? null : i);
              }}>
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
                <circle cx="3.5" cy="8" r="1.4" fill="currentColor" />
                <circle cx="8" cy="8" r="1.4" fill="currentColor" />
                <circle cx="12.5" cy="8" r="1.4" fill="currentColor" />
              </svg>
            </button>
            {menu === i && (
              <div className="scene-menu menu" role="menu" style={{ left: menuAt.x, top: menuAt.y }}>
                {[
                  { label: "Rename", run: () => setRenaming(i) },
                  { label: "Duplicate", run: () => props.onDuplicate(i) },
                  { label: "Move left", run: () => props.onMove(i, -1), off: i === 0 },
                  { label: "Move right", run: () => props.onMove(i, 1), off: i === props.scenes.length - 1 },
                  { label: "Delete scene", run: () => props.onDelete(i), off: props.scenes.length === 1, danger: true },
                ].map((m) => (
                  <button
                    key={m.label}
                    type="button"
                    role="menuitem"
                    className={m.danger ? "danger" : ""}
                    disabled={m.off}
                    onClick={() => {
                      setMenu(null);
                      m.run();
                    }}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <button type="button" className="btn btn-secondary btn-small scene-add" disabled={props.disabled} onClick={props.onAdd}>
        + New scene
      </button>
    </div>
  );
}
