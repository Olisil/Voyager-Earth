import type { Map as MLMap } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { searchPlaces, type Place } from "../lib/geocode";
import type { RouteModel } from "../lib/model";
import { TRANSPORT_IDS, TRANSPORTS, transportIcon } from "../lib/transports";
import type { Scene, TransportId } from "../lib/types";

// ---------- search ----------

export function SearchBox({ map }: { map: MLMap | null }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(tag)) {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => input.current?.focus(), 0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      setError(null);
      return;
    }
    const ac = new AbortController();
    const id = setTimeout(() => {
      searchPlaces(q.trim(), ac.signal)
        .then((r) => {
          setResults(r);
          setActive(0);
          setError(r.length ? null : "No places found. Try another spelling.");
        })
        .catch((e) => {
          if (e.name !== "AbortError") setError("Search isn't answering. Check your connection and try again.");
        });
    }, 300);
    return () => {
      clearTimeout(id);
      ac.abort();
    };
  }, [q]);

  const go = (p: Place) => {
    if (!map) return;
    if (p.extent) {
      const [a, b, c, d] = p.extent;
      map.fitBounds(
        [
          [Math.min(a, c), Math.min(b, d)],
          [Math.max(a, c), Math.max(b, d)],
        ],
        { padding: 40, maxZoom: 13, duration: 1200 },
      );
    } else map.flyTo({ center: p.at, zoom: p.zoom, duration: 1200 });
    setOpen(false);
    setQ("");
    setResults([]);
  };

  if (!open)
    return (
      <button type="button" className="map-btn search-toggle" aria-label="Search for a place (press /)" title="Search for a place (/)" onClick={() => {
        setOpen(true);
        setTimeout(() => input.current?.focus(), 0);
      }}>
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden>
          <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="m13 13 4.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    );

  return (
    <div className="search" role="search">
      <input
        ref={input}
        className="input"
        placeholder="Find a city, peak or lake"
        aria-label="Search for a place"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onBlur={() => setTimeout(() => !q && setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            setQ("");
          }
          if (e.key === "ArrowDown") setActive((a) => Math.min(results.length - 1, a + 1));
          if (e.key === "ArrowUp") setActive((a) => Math.max(0, a - 1));
          if (e.key === "Enter" && results[active]) go(results[active]);
        }}
      />
      {(results.length > 0 || error) && (
        <ul className="search-results menu" role="listbox">
          {error && <li className="search-empty">{error}</li>}
          {results.map((r, i) => (
            <li key={`${r.name}-${i}`} role="option" aria-selected={i === active}>
              <button type="button" className={i === active ? "on" : ""} onMouseDown={(e) => e.preventDefault()} onClick={() => go(r)}>
                <strong>{r.name}</strong>
                <span>{r.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------- legs ----------

export function LegsPanel(props: {
  scene: Scene;
  model: RouteModel | null;
  onChange: (legIndex: number, t: TransportId) => void;
  onStyle: (t: TransportId) => void;
}) {
  const [open, setOpen] = useState(true);
  const legs = props.model?.legs ?? [];
  if (!legs.length) return null;
  return (
    <div className="legs">
      <button type="button" className="legs-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        Legs <span className="legs-count">{legs.length}</span>
        <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden style={{ transform: open ? "rotate(180deg)" : undefined }}>
          <path d="M3 7.5 6 4.5 9 7.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <ol>
          {legs.map((l) => (
            <li key={l.index}>
              <button type="button" className="leg-style" title={`Style ${TRANSPORTS[l.transport].label.toLowerCase()} legs`} onClick={() => props.onStyle(l.transport)}>
                <img src={transportIcon(l.transport, props.scene.look.transports[l.transport].color, 28)} alt="" width={22} height={22} />
              </button>
              <select
                aria-label={`Leg ${l.index + 1} travels by`}
                value={l.transport}
                onChange={(e) => props.onChange(l.index, e.target.value as TransportId)}
              >
                {TRANSPORT_IDS.map((id) => (
                  <option key={id} value={id}>
                    {TRANSPORTS[id].label}
                  </option>
                ))}
              </select>
              <span className="leg-km">{l.km < 10 ? l.km.toFixed(1) : Math.round(l.km).toLocaleString("en")} km</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ---------- point popover ----------

export function PointPopover(props: {
  scene: Scene;
  index: number;
  at: { x: number; y: number };
  currentTransport: TransportId;
  onTransport: (t: TransportId) => void;
  onPause: (s: number) => void;
  onSharp: (v: boolean) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const p = props.scene.route.points[props.index];
  if (!p) return null;
  const last = props.index === props.scene.route.points.length - 1;
  return (
    <div className={`popover${props.at.y < 230 ? " below" : ""}`} style={{ left: props.at.x, top: props.at.y }} role="dialog" aria-label={`Point ${props.index + 1}`}>
      <div className="popover-head">
        <strong>Point {props.index + 1}</strong>
        <button type="button" className="icon-btn" aria-label="Close" onClick={props.onClose}>
          ×
        </button>
      </div>
      {!last && (
        <label className="popover-row">
          <span>Travel from here by</span>
          <select value={props.currentTransport} onChange={(e) => props.onTransport(e.target.value as TransportId)}>
            {TRANSPORT_IDS.map((id) => (
              <option key={id} value={id}>
                {TRANSPORTS[id].label}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="popover-row">
        <span>Pause here</span>
        <div className="mini-seg" role="radiogroup" aria-label="Pause here">
          {[0, 0.5, 1, 2, 3, 5].map((s) => (
            <button key={s} type="button" role="radio" aria-checked={(p.pause ?? 0) === s} className={(p.pause ?? 0) === s ? "on" : ""} onClick={() => props.onPause(s)}>
              {s ? `${s}s` : "No"}
            </button>
          ))}
        </div>
      </div>
      {props.scene.route.smooth && props.index > 0 && !last && (
        <label className="popover-check">
          <input type="checkbox" checked={!!p.sharp} onChange={(e) => props.onSharp(e.target.checked)} />
          Sharp corner
        </label>
      )}
      <button type="button" className="btn btn-small btn-quiet btn-danger" onClick={props.onRemove}>
        Remove point
      </button>
    </div>
  );
}
