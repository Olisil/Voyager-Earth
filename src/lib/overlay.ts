import type { FrameState } from "./camera";
import type { Timeline } from "./model";
import { glyphInk, TRANSPORTS } from "./transports";
import type { LngLat, Scene, Sign } from "./types";

export const FONT_HEAD = '"Neugrotypeface", "Raleway Variablefont Wght", "Raleway Variable", sans-serif';
export const FONT_BODY = '"Raleway Variablefont Wght", "Raleway Variable", system-ui, sans-serif';

export interface Hit {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OverlayInput {
  scene: Scene;
  frame: FrameState | null;
  timeline: Timeline | null;
  /** null = editing: every sign shown in full */
  t: number | null;
  toScreen: (ll: LngLat) => { x: number; y: number };
  mapBearing: number;
  /** css size of the frame */
  width: number;
  height: number;
  /** canvas pixels per css pixel */
  scale: number;
  credit: string | null;
  selectedSign?: string | null;
  image: (url: string) => HTMLImageElement | null;
}

const backOut = (x: number) => {
  const c = 1.7;
  const k = Math.min(1, Math.max(0, x)) - 1;
  return 1 + (c + 1) * k * k * k + c * k * k;
};

// ---------- tip symbol ----------

function drawSymbol(g: CanvasRenderingContext2D, o: OverlayInput) {
  const f = o.frame;
  if (!f) return;
  const st = o.scene.look.transports[f.leg.transport];
  if (st.symbol === "none") return;
  const p = o.toScreen(f.tip);
  const color = st.symbolColor ?? st.color;
  const heading = ((f.tipBearing - o.mapBearing) * Math.PI) / 180;
  const r = 15 * o.scene.look.symbolScale;
  g.save();
  g.translate(p.x, p.y);
  g.shadowColor = "rgba(0,0,0,0.45)";
  g.shadowBlur = 6;
  g.shadowOffsetY = 2;
  if (st.symbol === "dot") {
    g.beginPath();
    g.arc(0, 0, r * 0.55, 0, Math.PI * 2);
    g.fillStyle = color;
    g.fill();
    g.shadowColor = "transparent";
    g.lineWidth = 2.5;
    g.strokeStyle = "#fff";
    g.stroke();
  } else if (st.symbol === "arrow") {
    g.rotate(heading);
    const a = r * 1.05;
    g.beginPath();
    g.moveTo(0, -a);
    g.lineTo(a * 0.8, a * 0.85);
    g.lineTo(0, a * 0.4);
    g.lineTo(-a * 0.8, a * 0.85);
    g.closePath();
    g.lineJoin = "round";
    g.fillStyle = color;
    g.fill();
    g.shadowColor = "transparent";
    g.lineWidth = 2.2;
    g.strokeStyle = "#fff";
    g.stroke();
  } else {
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.fillStyle = color;
    g.fill();
    g.shadowColor = "transparent";
    g.lineWidth = 2.5;
    g.strokeStyle = "#fff";
    g.stroke();
    const T = TRANSPORTS[f.leg.transport];
    if (T.rotates) g.rotate(heading);
    else if (Math.sin(heading) < -0.05) g.scale(-1, 1);
    T.glyph(g, r * 0.78, color, glyphInk(color));
  }
  g.restore();
}

// ---------- signs ----------

function textWidth(g: CanvasRenderingContext2D, text: string) {
  return g.measureText(text || " ").width;
}

function anchorDot(g: CanvasRenderingContext2D, k: number, fill = "#0e0e0e", ring = "#ffffff") {
  g.beginPath();
  g.arc(0, 0, 4.5 * k, 0, Math.PI * 2);
  g.fillStyle = fill;
  g.fill();
  g.lineWidth = 2 * k;
  g.strokeStyle = ring;
  g.stroke();
}

/** Draws one sign with its anchor at 0,0 and returns its bounds relative to the anchor. */
function drawSign(g: CanvasRenderingContext2D, sign: Sign, k: number, image: OverlayInput["image"]): [number, number, number, number] {
  const text = sign.text.trim();
  g.textBaseline = "middle";
  switch (sign.style) {
    case "plate": {
      g.font = `500 ${18 * k}px ${FONT_HEAD}`;
      const w = textWidth(g, text) + 28 * k;
      const h = 38 * k;
      const post = 22 * k;
      g.fillStyle = "#e6e6e6";
      g.fillRect(-1.5 * k, -post, 3 * k, post);
      g.beginPath();
      g.roundRect(-w / 2, -post - h, w, h, 4 * k);
      g.fillStyle = "rgba(14,14,14,0.92)";
      g.fill();
      g.lineWidth = 2 * k;
      g.strokeStyle = "#bad70a";
      g.stroke();
      g.fillStyle = "#e6e6e6";
      g.textAlign = "center";
      g.fillText(text, 0, -post - h / 2 + 1 * k);
      anchorDot(g, k);
      return [-w / 2, -post - h, w, h + post + 5 * k];
    }
    case "tag": {
      g.font = `600 ${16 * k}px ${FONT_BODY}`;
      const w = textWidth(g, text) + 24 * k;
      const h = 34 * k;
      const gap = 12 * k;
      g.shadowColor = "rgba(0,0,0,0.35)";
      g.shadowBlur = 8 * k;
      g.shadowOffsetY = 2 * k;
      g.beginPath();
      g.roundRect(-w / 2, -gap - h, w, h, 6 * k);
      g.moveTo(-7 * k, -gap);
      g.lineTo(0, 0);
      g.lineTo(7 * k, -gap);
      g.fillStyle = "#ffffff";
      g.fill();
      g.shadowColor = "transparent";
      g.fillStyle = "#0e0e0e";
      g.textAlign = "center";
      g.fillText(text, 0, -gap - h / 2 + 1 * k);
      return [-w / 2, -gap - h, w, h + gap];
    }
    case "pin": {
      g.font = `600 ${16 * k}px ${FONT_BODY}`;
      const w = textWidth(g, text);
      anchorDot(g, k * 1.3, "#bad70a", "#0e0e0e");
      g.textAlign = "left";
      g.lineJoin = "round";
      g.lineWidth = 4 * k;
      g.strokeStyle = "rgba(14,14,14,0.85)";
      g.strokeText(text, 12 * k, 0);
      g.fillStyle = "#ffffff";
      g.fillText(text, 12 * k, 0);
      return [-8 * k, -12 * k, w + 22 * k, 24 * k];
    }
    case "flag": {
      g.font = `500 ${15 * k}px ${FONT_HEAD}`;
      const pole = 56 * k;
      const w = textWidth(g, text) + 26 * k;
      const h = 26 * k;
      g.fillStyle = "#e6e6e6";
      g.fillRect(-1.25 * k, -pole, 2.5 * k, pole);
      g.beginPath();
      g.moveTo(0, -pole);
      g.lineTo(w, -pole);
      g.lineTo(w - 9 * k, -pole + h / 2);
      g.lineTo(w, -pole + h);
      g.lineTo(0, -pole + h);
      g.closePath();
      g.fillStyle = "#c5a11f";
      g.fill();
      g.fillStyle = "#0e0e0e";
      g.textAlign = "left";
      g.fillText(text, 8 * k, -pole + h / 2 + 1 * k);
      anchorDot(g, k * 0.8);
      return [-6 * k, -pole - 2 * k, w + 8 * k, pole + 8 * k];
    }
    case "caption": {
      g.font = `500 ${30 * k}px ${FONT_HEAD}`;
      const w = textWidth(g, text);
      g.textAlign = "center";
      g.shadowColor = "rgba(0,0,0,0.7)";
      g.shadowBlur = 10 * k;
      g.fillStyle = "#ffffff";
      g.fillText(text, 0, 0);
      g.shadowColor = "transparent";
      return [-w / 2 - 6 * k, -22 * k, w + 12 * k, 44 * k];
    }
    case "photo": {
      const pw = 132 * k;
      const frame = 8 * k;
      const capH = text ? 30 * k : 10 * k;
      const w = pw + frame * 2;
      const h = pw + frame + capH;
      const lift = 30 * k;
      g.strokeStyle = "rgba(230,230,230,0.9)";
      g.lineWidth = 1.5 * k;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(0, -lift);
      g.stroke();
      anchorDot(g, k * 0.8);
      g.save();
      g.translate(0, -lift - h / 2);
      g.rotate(-0.045);
      g.shadowColor = "rgba(0,0,0,0.45)";
      g.shadowBlur = 14 * k;
      g.shadowOffsetY = 4 * k;
      g.fillStyle = "#f7f5f0";
      g.fillRect(-w / 2, -h / 2, w, h);
      g.shadowColor = "transparent";
      const img = sign.photo ? image(sign.photo) : null;
      const ix = -w / 2 + frame;
      const iy = -h / 2 + frame;
      if (img) {
        const s = Math.min(img.naturalWidth, img.naturalHeight);
        g.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, ix, iy, pw, pw);
      } else {
        g.fillStyle = "#393939";
        g.fillRect(ix, iy, pw, pw);
        g.fillStyle = "#e6e6e6";
        g.font = `500 ${13 * k}px ${FONT_BODY}`;
        g.textAlign = "center";
        g.fillText("Add a photo", 0, iy + pw / 2);
      }
      if (text) {
        g.fillStyle = "#252525";
        g.font = `italic 500 ${15 * k}px ${FONT_BODY}`;
        g.textAlign = "center";
        g.fillText(text, 0, h / 2 - capH / 2, pw);
      }
      g.restore();
      return [-w / 2 - 4 * k, -lift - h - 6 * k, w + 8 * k, h + lift + 6 * k];
    }
  }
}

function drawSigns(g: CanvasRenderingContext2D, o: OverlayInput): Hit[] {
  const hits: Hit[] = [];
  const k = o.scene.signScale;
  for (const sign of o.scene.signs) {
    let amount = 1;
    if (o.t !== null && sign.show === "passed") {
      const tp = o.timeline?.signTimes[sign.id];
      if (tp === undefined || o.t < tp) continue;
      amount = Math.min(1, (o.t - tp) / 0.5);
    }
    const p = o.toScreen(sign.at);
    g.save();
    g.translate(p.x, p.y);
    if (amount < 1) {
      g.globalAlpha = Math.min(1, amount * 2);
      const s = 0.4 + 0.6 * backOut(amount);
      g.scale(s, s);
    }
    const [x, y, w, h] = drawSign(g, sign, k, o.image);
    if (o.selectedSign === sign.id) {
      g.setLineDash([5, 4]);
      g.lineWidth = 1.5;
      g.strokeStyle = "#e6ff4c";
      g.strokeRect(x - 4, y - 4, w + 8, h + 8);
    }
    g.restore();
    hits.push({ id: sign.id, x: p.x + x, y: p.y + y, w, h });
  }
  return hits;
}

// ---------- compass and credit ----------

function drawCompass(g: CanvasRenderingContext2D, o: OverlayInput) {
  const c = o.scene.look.compass;
  if (!c.on) return;
  const r = 28 * c.size;
  const m = 20 + r;
  const x = c.corner.endsWith("l") ? m : o.width - m;
  const y = c.corner.startsWith("t") ? m : o.height - m - (c.corner.endsWith("r") && o.credit ? 28 : 0);
  g.save();
  g.translate(x, y);
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fillStyle = "rgba(14,14,14,0.72)";
  g.fill();
  g.lineWidth = 1.5;
  g.strokeStyle = "rgba(230,230,230,0.5)";
  g.stroke();
  g.rotate((-o.mapBearing * Math.PI) / 180);
  if (c.style === "rose") {
    for (let i = 0; i < 8; i++) {
      const long = i % 2 === 0;
      const len = (long ? 0.82 : 0.5) * r;
      g.save();
      g.rotate((i * Math.PI) / 4);
      g.beginPath();
      g.moveTo(0, -len);
      g.lineTo(0.13 * r, 0);
      g.lineTo(0, 0.13 * r);
      g.closePath();
      g.fillStyle = i === 0 ? "#bad70a" : "#e6e6e6";
      g.fill();
      g.beginPath();
      g.moveTo(0, -len);
      g.lineTo(-0.13 * r, 0);
      g.lineTo(0, 0.13 * r);
      g.closePath();
      g.fillStyle = i === 0 ? "#7f9306" : "#8a8a8a";
      g.fill();
      g.restore();
    }
  } else {
    g.beginPath();
    g.moveTo(0, -0.62 * r);
    g.lineTo(0.17 * r, 0);
    g.lineTo(-0.17 * r, 0);
    g.closePath();
    g.fillStyle = "#bad70a";
    g.fill();
    g.beginPath();
    g.moveTo(0, 0.62 * r);
    g.lineTo(0.17 * r, 0);
    g.lineTo(-0.17 * r, 0);
    g.closePath();
    g.fillStyle = "#e6e6e6";
    g.fill();
    g.font = `500 ${0.3 * r}px ${FONT_HEAD}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "#e6e6e6";
    g.fillText("N", 0, -0.8 * r);
  }
  g.restore();
}

function drawCredit(g: CanvasRenderingContext2D, o: OverlayInput) {
  if (!o.credit) return;
  const size = Math.max(10, Math.round(Math.min(o.width, o.height) * 0.017));
  g.font = `500 ${size}px ${FONT_BODY}`;
  const pad = Math.round(size * 0.55);
  const w = g.measureText(o.credit).width + pad * 2;
  const h = size + pad * 1.2;
  const x = o.width - w - pad;
  const y = o.height - h - pad;
  g.fillStyle = "rgba(14,14,14,0.6)";
  g.fillRect(x, y, w, h);
  g.fillStyle = "rgba(230,230,230,0.92)";
  g.textBaseline = "middle";
  g.textAlign = "left";
  g.fillText(o.credit, x + pad, y + h / 2 + 1);
}

/** Draws everything that sits on top of the map. Returns where the signs are, for dragging. */
export function drawOverlay(g: CanvasRenderingContext2D, o: OverlayInput): Hit[] {
  g.save();
  g.scale(o.scale, o.scale);
  const hits = drawSigns(g, o);
  drawSymbol(g, o);
  drawCompass(g, o);
  drawCredit(g, o);
  g.restore();
  return hits;
}

// ---------- images ----------

const images = new Map<string, HTMLImageElement>();
export function cachedImage(url: string, onLoad?: () => void): HTMLImageElement | null {
  let img = images.get(url);
  if (!img) {
    img = new Image();
    img.decoding = "async";
    img.onload = () => onLoad?.();
    img.src = url;
    images.set(url, img);
  }
  return img.complete && img.naturalWidth ? img : null;
}

export async function preloadImages(urls: string[]) {
  await Promise.all(
    urls.map(async (u) => {
      cachedImage(u);
      try {
        await images.get(u)!.decode();
      } catch {
        /* a broken photo renders as the placeholder */
      }
    }),
  );
}

/** Shrinks a picked photo to something that fits comfortably in a project. */
export async function photoToDataUrl(file: File, max = 900): Promise<string> {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c.toDataURL("image/jpeg", 0.85);
}

export async function ensureFonts() {
  await Promise.all([
    document.fonts.load(`500 20px ${FONT_HEAD}`),
    document.fonts.load(`600 20px ${FONT_BODY}`),
    document.fonts.load(`italic 500 20px ${FONT_BODY}`),
  ]).catch(() => {});
}
