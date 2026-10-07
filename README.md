# Färdväg (working title)

Animated route maps for travel films, as a page on nassau.se. Draw a route or drop in a GPX
file, switch transport per leg, add signs and photos, pick a camera move, and render an MP4 in
the browser. No backend, no accounts: projects live in the browser (IndexedDB) and can be
downloaded as `.fardvag.json` files.

## Run locally

    npm install
    npm run dev        # http://localhost:5173

Node 22+. Rendering needs WebCodecs H.264: current Chrome or Edge on desktop is the reference.

## Deploy as a page under nassau.se (Webflow Cloud)

Plain Vite + React, which Webflow Cloud builds directly (`webflow.json` pins `vite`). Don't set
`base` in `vite.config.ts`; Webflow Cloud sets it from the mount path. Routing is hash based
(`#/`, `#/p/<id>`), so any mount path works without rewrites.

1. Push this folder to GitHub (contents at the repository root).
2. nassau.se site settings > Webflow Cloud > create a project from the repository, mount path
   e.g. `/fardvag`.
3. Publish the site once. Every push to the branch redeploys.

## Design system

`src/styles.css` uses the exact Webflow variables of nassau.se (names and values from the
site's "Base" collection): `--color--*` light values, `--dark--*` dark values, `--space--*`,
`--size--*`, `--stroke--*`, `--radius--*`, `--headings`, `--persist-*`. As on the site, the class
`dark-mode` on `<html>` swaps them, and the choice is shared with the rest of nassau.se through
`localStorage["dark-mode"]` (dark by default). The header uses the site's logo file and the
same `toggle_wrap` theme toggle. Fonts are the site's own (Neugrotypeface, Raleway variable)
from the Webflow CDN, with a bundled Raleway as fallback for local development.

Components follow the "Nassau New" Figma design system:

| Figma component | Used for | Class |
| --- | --- | --- |
| Button / Primary | Next step, Render video, Download MP4, Create project, Play | `.btn.btn-primary` |
| Button / Secondary | Open a project file, New scene, Project menu | `.btn.btn-secondary` |
| Button Tool / Secondary | Detailed controls: Undo, Reverse, Use this view, Duplicate | `.btn` |
| Button Tool / Primary | Chosen option in segmented controls, active tool, chosen transport | `.segmented .on` |
| Nav link | The current step | `.step.on` |
| Pill | Counts and meta | `.pill` |
| Text field | Text inputs | `.input` |
| Theme toggle | Light/dark switch | `.toggle_wrap` |

Glass (bg/glass + 20 px blur) for the header and floating map tools; 350 ms ease on colour and
border. Deviations: Button Tool / Primary keeps bright text in light mode (dark text on Dim Grey
fails contrast), and on/off switches, which the system doesn't define, borrow the Theme
toggle's shape.

To keep tokens in sync when the site changes, update the block at the top of `styles.css`, or
export them with Webflow DevLink.

## Code map

- `lib/types.ts`: project format (scenes, legs, pauses, signs), defaults, upgrades v1 files
- `lib/model.ts`: geometry per leg (great-circle flights, date line, smoothing with sharp
  corners) and the timeline (speed per transport, pauses, sign times)
- `lib/camera.ts`: fixed, start-to-end glide, follow; open/close on the whole route
- `lib/mapScene.ts`: MapLibre themes and per-leg line layers
- `lib/overlay.ts`: tip symbol, signs, compass, credit on a canvas, shared by preview and export
- `lib/exporter.ts`: renders one or all scenes and encodes MP4; pauses while the tab is hidden
- `lib/db.ts`: IndexedDB projects and project files
- `lib/geocode.ts`: place search (Photon / OpenStreetMap)

## Data sources and licences

OpenFreeMap vector tiles (© OpenStreetMap contributors, OpenMapTiles); AWS terrain tiles
(Mapzen); EOX Sentinel-2 cloudless 2016 for satellite (CC BY 4.0, fair-use tile service);
Photon by Komoot for search. The export burns in a map credit by default.

## Not yet built

3D vehicle symbols, more map themes, your own map image or symbol, photo at the tip, zoom per
transport, preview playing all scenes in a row.
