import type { Map as MLMap } from "maplibre-gl";
import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, canEncodeVideo, type VideoCodec } from "mediabunny";
import { frameAt } from "./camera";
import { ensureTheme, showFrame, waitForIdle } from "./mapScene";
import { makeTimeline, type RouteModel } from "./model";
import { cachedImage, drawOverlay, ensureFonts, preloadImages } from "./overlay";
import { outputSize, type Project, type Scene } from "./types";

export interface ExportProgress {
  frame: number;
  frames: number;
  elapsedMs: number;
  scene: number;
  scenes: number;
  paused: boolean;
}

export interface ExportResult {
  blob: Blob;
  width: number;
  height: number;
  codec: VideoCodec;
}

export class ExportUnsupportedError extends Error {}

const bitrateFor = (w: number, h: number, fps: number) => Math.round(w * h * fps * 0.15);

export async function pickCodec(width: number, height: number, fps: number): Promise<VideoCodec> {
  if (typeof VideoEncoder === "undefined") {
    throw new ExportUnsupportedError(
      "This browser can't make videos. Use a recent Chrome, Edge or Safari on a computer to render.",
    );
  }
  const bitrate = bitrateFor(width, height, fps);
  // H.264 first: every editor and player opens it. The rest are last resorts.
  for (const codec of ["avc", "hevc", "vp9", "av1"] as VideoCodec[]) {
    if (await canEncodeVideo(codec, { width, height, bitrate })) return codec;
  }
  throw new ExportUnsupportedError(
    `This computer can't make ${width}×${height} video in this browser. Pick a lower resolution, or try Chrome.`,
  );
}

export function creditFor(scene: Scene): string {
  const parts =
    scene.look.theme === "satellite"
      ? ["Sentinel-2 cloudless by EOX (Copernicus data 2016)"]
      : ["© OpenStreetMap contributors", "OpenMapTiles", "OpenFreeMap"];
  if (scene.look.terrain) parts.push("Mapzen terrain");
  return parts.join(", ");
}

function whenVisible(): Promise<void> {
  if (!document.hidden) return Promise.resolve();
  return new Promise((resolve) => {
    const on = () => {
      if (!document.hidden) {
        document.removeEventListener("visibilitychange", on);
        resolve();
      }
    };
    document.addEventListener("visibilitychange", on);
  });
}

/**
 * Renders scenes frame by frame on the live map at full output resolution, waiting for every
 * tile before each capture, draws the overlay on top, and encodes MP4 in the browser.
 */
export async function renderVideo(opts: {
  map: MLMap;
  project: Project;
  scenes: number[];
  models: (RouteModel | null)[];
  signal: AbortSignal;
  onProgress: (p: ExportProgress) => void;
}): Promise<ExportResult> {
  const { map, project, signal, onProgress } = opts;
  const out = project.output;
  const { width, height } = outputSize(out.aspect, out.resolution);
  const fps = out.fps;
  const codec = await pickCodec(width, height, fps);

  const jobs = opts.scenes
    .map((i) => ({ scene: project.scenes[i], model: opts.models[i] }))
    .filter((j): j is { scene: Scene; model: RouteModel } => !!j.model)
    .map((j) => ({ ...j, timeline: makeTimeline(j.model, j.scene, out) }));
  if (!jobs.length) throw new Error("There is no route to render. Draw at least two points first.");

  await ensureFonts();
  await preloadImages(jobs.flatMap((j) => j.scene.signs.map((s) => s.photo).filter((u): u is string => !!u)));

  const mapCanvas = map.getCanvas();
  const container = map.getContainer();
  const vp = { width: container.clientWidth, height: container.clientHeight };
  const scale = width / vp.width;
  const previousRatio = map.getPixelRatio();

  const frameCanvas = document.createElement("canvas");
  frameCanvas.width = width;
  frameCanvas.height = height;
  const g = frameCanvas.getContext("2d", { alpha: false })!;
  g.imageSmoothingQuality = "high";

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
  const source = new CanvasSource(frameCanvas, { codec, bitrate: bitrateFor(width, height, fps), keyFrameInterval: 2 });
  output.addVideoTrack(source, { frameRate: fps });

  const frameCounts = jobs.map((j) => Math.max(1, Math.round(j.timeline.total * fps)));
  const frames = frameCounts.reduce((a, b) => a + b, 0);
  const started = performance.now();
  let done = 0;

  map.setPixelRatio(scale);
  const handlers = [map.dragPan, map.scrollZoom, map.boxZoom, map.dragRotate, map.keyboard, map.doubleClickZoom, map.touchZoomRotate];
  handlers.forEach((h) => h.disable());

  try {
    await output.start();
    for (let j = 0; j < jobs.length; j++) {
      const { scene, model, timeline } = jobs[j];
      await ensureTheme(map, scene);
      const credit = out.credit ? creditFor(scene) : null;
      for (let i = 0; i < frameCounts[j]; i++) {
        if (signal.aborted) throw new DOMException("Render cancelled", "AbortError");
        const t = i / fps;
        const frame = frameAt(scene, model, timeline, t, vp);
        showFrame(map, scene, model, frame, true);
        // A hidden tab stops drawing: wait until it's back, then make sure the frame is complete.
        do {
          if (document.hidden) {
            onProgress({ frame: done, frames, elapsedMs: performance.now() - started, scene: j + 1, scenes: jobs.length, paused: true });
            await whenVisible();
          }
          await waitForIdle(map);
        } while (document.hidden);
        g.drawImage(mapCanvas, 0, 0, mapCanvas.width, mapCanvas.height, 0, 0, width, height);
        drawOverlay(g, {
          scene,
          frame,
          timeline,
          t,
          toScreen: (ll) => map.project(ll),
          mapBearing: map.getBearing(),
          width: vp.width,
          height: vp.height,
          scale,
          credit,
          image: (u) => cachedImage(u),
        });
        await source.add(done / fps, 1 / fps);
        done++;
        onProgress({ frame: done, frames, elapsedMs: performance.now() - started, scene: j + 1, scenes: jobs.length, paused: false });
      }
    }
    await output.finalize();
  } catch (err) {
    if (output.state !== "finalized") await output.cancel().catch(() => {});
    throw err;
  } finally {
    map.setPixelRatio(previousRatio);
    handlers.forEach((h) => h.enable());
    map.triggerRepaint();
  }

  const buffer = output.target.buffer;
  if (!buffer) throw new Error("The video came out empty. Try rendering again.");
  return { blob: new Blob([buffer], { type: "video/mp4" }), width, height, codec };
}
