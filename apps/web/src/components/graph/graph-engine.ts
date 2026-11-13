import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  LineDashedMaterial,
  LineSegments,
  MOUSE,
  NormalBlending,
  PerspectiveCamera,
  Points,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  TOUCH,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { KIND_BIT, type GraphData, type GraphNode } from "@/server/graph/types";
import { shapeOf, shortLabel, type CanvasPalette } from "./graph-utils";
import {
  adjacency,
  flatPositions,
  initPositions,
  labelWidth,
  layoutRequest,
  placeLabels,
  worldRadius,
  type LabelCandidate,
  type LayoutReply,
  type PlacedLabel,
} from "./layout3d";
import { t } from "@/i18n";

/*
 * WebGL renderer of the knowledge graph (three.js, loaded only on /graph).
 *
 * Nodes are one `Points` draw call (a shader paints round entries and rounded-square objects with
 * soft shading, depth fog and a selection ring); edges are one `LineSegments` call. Nothing is
 * created per frame. The 3D layout runs in a worker; the renderer eases its nodes toward each
 * result, so the graph unfolds calmly from the familiar 2D picture into a sphere.
 *
 * Frames are drawn on demand only (camera motion, easing, hover), so a resting graph costs no CPU
 * or GPU (important in the Windows app's WebView2).
 *
 * Labels are HTML (sharp at every zoom, no texture upload delay) in one overlay: a fixed pool of
 * buttons that are moved with `transform` each frame; React never re-renders for them. Shown are the
 * focused node with its neighbours, the open note, the suggestion pair and the nodes nearest to
 * the camera, collision-free.
 */

export type GraphMode = "3d" | "2d";

export interface EngineOptions {
  onOpen: (id: string) => void;
  onMenu: (id: string, at: { x: number; y: number }) => void;
  onLink: () => void;
  reducedMotion: boolean;
}

const POOL = 60;
const MAX_LABELS = 34;
const FOV = 50;
const FLY_MS = 750;

const VERT_NODE = /* glsl */ `
attribute float aSize;
attribute float aState;
attribute float aShape;
uniform float uScale;
uniform float uMinPx;
uniform float uFogNear;
uniform float uFogFar;
varying float vState;
varying float vShape;
varying float vFog;
varying float vPx;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float depth = max(-mv.z, 1.0);
  float boost = aState > 1.5 ? 1.45 : (aState > 0.5 ? 1.15 : 1.0);
  float px = clamp(aSize * boost * uScale / depth, uMinPx, 110.0);
  gl_PointSize = px;
  gl_Position = projectionMatrix * mv;
  vPx = px;
  vState = aState;
  vShape = aShape;
  vFog = smoothstep(uFogNear, uFogFar, depth);
}`;

const FRAG_NODE = /* glsl */ `
uniform vec3 uNode;
uniform vec3 uAccent;
uniform vec3 uInk;
uniform vec3 uBg;
uniform float uDim;
uniform float uDark;
varying float vState;
varying float vShape;
varying float vFog;
varying float vPx;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float sd;
  if (vShape > 0.5) {
    vec2 q = abs(c) - vec2(0.56);
    sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.26;
  } else {
    sd = length(c) - 1.0;
  }
  float aa = 2.4 / vPx;
  float alpha = 1.0 - smoothstep(-aa, 0.0, sd);
  if (alpha < 0.02) discard;
  vec3 col = uNode;
  if (vState > 2.5) col = uAccent;
  else if (vState > 0.5) col = uInk;
  // Soft volume: a little light from the upper left, a little shade at the rim.
  float lit = clamp(1.0 - length(c - vec2(-0.38, -0.38)) * 0.7, 0.0, 1.0);
  col = mix(col * (uDark > 0.5 ? 0.78 : 0.86), min(col * 1.18 + 0.04, vec3(1.0)), lit);
  if (vState > 2.5) {
    float ring = smoothstep(-0.46, -0.40, sd) * (1.0 - smoothstep(-0.30, -0.24, sd));
    col = mix(col, uBg, ring * 0.9);
  }
  float dim = vState < 0.5 ? uDim * 0.8 : 0.0;
  col = mix(col, uBg, max(dim, vFog * 0.8));
  gl_FragColor = vec4(col, alpha);
}`;

const VERT_EDGE = /* glsl */ `
attribute float aState;
attribute float aKind;
uniform float uFogNear;
uniform float uFogFar;
varying float vState;
varying float vKind;
varying float vFog;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  vState = aState;
  vKind = aKind;
  vFog = smoothstep(uFogNear, uFogFar, -mv.z);
}`;

const FRAG_EDGE = /* glsl */ `
uniform vec3 uEdge;
uniform vec3 uInk;
uniform float uAlpha;
uniform float uDim;
varying float vState;
varying float vKind;
varying float vFog;
void main() {
  vec3 col = vKind > 0.5 && vKind < 1.5 ? uInk : uEdge;
  float a = uAlpha * (vKind > 1.5 ? 0.55 : (vKind > 0.5 ? 0.8 : 1.0));
  if (vState > 0.5) {
    col = uInk;
    a = min(1.0, uAlpha * 3.2 + 0.25);
  } else {
    a *= 1.0 - uDim * 0.82;
  }
  a *= 1.0 - vFog * 0.85;
  gl_FragColor = vec4(col, a);
}`;

/** Any CSS colour (rgb, hex, oklch, color-mix …) as sRGB 0..1, via a 1 px canvas. */
function cssRgb(ctx: CanvasRenderingContext2D, color: string, fallback: [number, number, number]): [number, number, number] {
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = "#000";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  if (d[3] === 0) return fallback;
  return [d[0]! / 255, d[1]! / 255, d[2]! / 255];
}

/** First opaque background colour of the element or an ancestor. */
function backgroundOf(el: HTMLElement): string {
  let cur: HTMLElement | null = el;
  while (cur) {
    const bg = getComputedStyle(cur).backgroundColor;
    if (bg && bg !== "transparent" && !/rgba\(.*,\s*0\)$/.test(bg)) return bg;
    cur = cur.parentElement;
  }
  return getComputedStyle(document.body).backgroundColor || "#111";
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

interface Fly {
  /** Animation time in ms; advances at most ~2 frames per frame, so a long frame (e.g. the note drawer mounting) slows the flight instead of making it jump. */
  elapsed: number;
  ms: number;
  fromPos: Vector3;
  toPos: Vector3;
  fromTarget: Vector3;
  toTarget: Vector3;
}

interface Slot {
  el: HTMLButtonElement;
  text: Text;
  i: number;
  x: number;
  y: number;
  o: number;
  cls: string;
}

export class GraphEngine {
  private host: HTMLElement;
  private opts: EngineOptions;
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(FOV, 1, 1, 100000);
  private controls: OrbitControls;
  private overlay: HTMLDivElement;
  private slots: Slot[] = [];
  private linkBtn: HTMLButtonElement;
  private ro: ResizeObserver;
  private worker: Worker | null = null;
  private token = 0;
  private colorCtx: CanvasRenderingContext2D;

  private w = 1;
  private h = 1;
  private dpr = 1;
  private mode: GraphMode = "3d";
  private reduced: boolean;

  // Graph
  private nodes: GraphNode[] = [];
  private edges: GraphData["edges"] = [];
  private labels: string[] = [];
  private widths: number[] = [];
  private adj: number[][] = [];
  private sizes: Float32Array = new Float32Array(0);
  private pos: Float32Array = new Float32Array(0);
  private target: Float32Array = new Float32Array(0);
  private flat: Float32Array = new Float32Array(0);
  private layout: Float32Array | null = null;
  private layoutDone = false;
  private known = new Map<string, [number, number, number]>();
  private radius = 100;

  // GPU objects
  private points: Points | null = null;
  private lines: LineSegments | null = null;
  private suggestLine: LineSegments;
  private nodeMat: ShaderMaterial;
  private edgeMat: ShaderMaterial;
  private edgeIdx = new Uint32Array(0);

  // Screen projection of the last frame (CSS px)
  private sx = new Float32Array(0);
  private sy = new Float32Array(0);
  private sd = new Float32Array(0);
  private sr = new Float32Array(0);
  private placed: PlacedLabel[] = [];
  private shown = new Set<number>();

  // Interaction
  private pointer: { x: number; y: number } | null = null;
  private down: { x: number; y: number; button: number } | null = null;
  private dragging = false;
  private hover = -1;
  private active = -1;
  private activeId: string | null = null;
  private suggestion: [string, string] | null = null;
  private suggestionIdx: [number, number] | null = null;
  private suggestionOpen = false;
  private focus = -1;
  private dim = 0;
  private fly: Fly | null = null;
  private touched = false;
  private fitDist = 400;

  // Loop
  private raf = 0;
  private last = 0;
  private moving = false;
  private movingTimer: ReturnType<typeof setTimeout> | null = null;
  private zoomShown = "";
  private disposed = false;

  constructor(host: HTMLElement, opts: EngineOptions) {
    this.host = host;
    this.opts = opts;
    this.reduced = opts.reducedMotion;
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0);
    const cv = this.renderer.domElement;
    cv.className = "gr-gl";
    cv.setAttribute("aria-hidden", "true");
    host.appendChild(cv);

    const probe = document.createElement("canvas");
    probe.width = probe.height = 1;
    this.colorCtx = probe.getContext("2d", { willReadFrequently: true })!;

    this.controls = new OrbitControls(this.camera, cv);
    this.controls.enableDamping = !this.reduced;
    this.controls.dampingFactor = 0.09;
    this.controls.rotateSpeed = 0.55;
    this.controls.zoomSpeed = 0.9;
    this.controls.panSpeed = 0.8;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 20000;
    this.controls.addEventListener("change", () => {
      this.markMoving();
      this.request();
    });
    this.controls.addEventListener("start", () => {
      this.fly = null;
      this.touched = true;
    });

    this.nodeMat = new ShaderMaterial({
      vertexShader: VERT_NODE,
      fragmentShader: FRAG_NODE,
      transparent: true,
      depthWrite: true,
      depthTest: true,
      uniforms: {
        uScale: { value: 1 },
        uMinPx: { value: 2 },
        uFogNear: { value: 100 },
        uFogFar: { value: 1000 },
        uNode: { value: new Vector3(0.78, 0.78, 0.8) },
        uAccent: { value: new Vector3(0.39, 0.4, 0.95) },
        uInk: { value: new Vector3(0.65, 0.7, 0.99) },
        uBg: { value: new Vector3(0.08, 0.08, 0.1) },
        uDim: { value: 0 },
        uDark: { value: 1 },
      },
    });
    this.edgeMat = new ShaderMaterial({
      vertexShader: VERT_EDGE,
      fragmentShader: FRAG_EDGE,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: AdditiveBlending,
      uniforms: {
        uEdge: { value: new Vector3(0.6, 0.62, 0.68) },
        uInk: { value: new Vector3(0.65, 0.7, 0.99) },
        uAlpha: { value: 0.3 },
        uDim: { value: 0 },
        uFogNear: { value: 100 },
        uFogFar: { value: 1000 },
      },
    });
    const sg = new BufferGeometry();
    sg.setAttribute("position", new BufferAttribute(new Float32Array(6), 3));
    this.suggestLine = new LineSegments(sg, new LineDashedMaterial({ dashSize: 5, gapSize: 4, transparent: true, opacity: 0.9, depthWrite: false }));
    this.suggestLine.visible = false;
    this.suggestLine.renderOrder = 2;
    this.scene.add(this.suggestLine);

    // Label overlay: a fixed pool of buttons.
    this.overlay = document.createElement("div");
    this.overlay.className = "gr-labels";
    host.appendChild(this.overlay);
    for (let k = 0; k < POOL; k++) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "gr-label kx-node";
      el.dataset.nodeLabel = "";
      el.tabIndex = -1;
      el.hidden = true;
      const dot = document.createElement("i");
      dot.setAttribute("aria-hidden", "true");
      const text = document.createTextNode("");
      el.append(dot, text);
      const slot: Slot = { el, text, i: -1, x: NaN, y: NaN, o: NaN, cls: "" };
      el.addEventListener("click", () => {
        if (slot.i >= 0) this.select(slot.i);
      });
      el.addEventListener("keydown", (e) => {
        const menuKey = e.key === "ContextMenu" || (e.shiftKey && e.key === "F10");
        if (!menuKey || slot.i < 0) return;
        e.preventDefault();
        const r = el.getBoundingClientRect();
        this.opts.onMenu(this.nodes[slot.i]!.id, { x: r.left + 12, y: r.bottom });
      });
      el.addEventListener("focus", () => this.setHover(slot.i));
      el.addEventListener("blur", () => this.setHover(-1));
      this.overlay.appendChild(el);
      this.slots.push(slot);
    }
    this.linkBtn = document.createElement("button");
    this.linkBtn.type = "button";
    this.linkBtn.className = "kx-btn kx-btn--ai kx-btn--sm gr-link-btn";
    this.linkBtn.textContent = t("New connection?");
    this.linkBtn.hidden = true;
    this.linkBtn.addEventListener("click", () => this.opts.onLink());
    this.overlay.appendChild(this.linkBtn);

    cv.addEventListener("pointerdown", this.onDown);
    cv.addEventListener("pointermove", this.onMove);
    cv.addEventListener("pointerup", this.onUp);
    cv.addEventListener("pointerleave", this.onLeave);
    cv.addEventListener("contextmenu", this.onContext, true);
    cv.addEventListener("dblclick", this.onDbl);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.applyMode();
    // Handle for the perf checks (dev, or the mock benchmark `?bench=N`).
    if (process.env.NODE_ENV !== "production" || /[?&]bench=/.test(window.location.search)) (window as unknown as { __kxGraph?: GraphEngine }).__kxGraph = this;
  }

  // --- Public API -------------------------------------------------------------------------------

  setData(data: GraphData): void {
    // Remember where every node was, so a filter change keeps the picture stable.
    for (let i = 0; i < this.nodes.length; i++) this.known.set(this.nodes[i]!.id, [this.pos[i * 3]!, this.pos[i * 3 + 1]!, this.pos[i * 3 + 2]!]);
    const first = this.nodes.length === 0;
    const n = data.nodes.length;
    this.nodes = data.nodes;
    this.edges = data.edges.filter((e) => e[0] < n && e[1] < n && e[0] !== e[1]);
    this.labels = data.nodes.map((x) => shortLabel(x.label));
    this.widths = this.labels.map(labelWidth);
    this.adj = adjacency(n, this.edges);
    this.radius = worldRadius(n);
    this.flat = flatPositions(data.nodes);
    const { init, reused } = initPositions(data.nodes, this.known);
    this.target = this.mode === "2d" ? this.flat.slice() : init;
    // First view: start flat (the 2D picture) and unfold; reduced motion starts where it ends.
    this.pos = first && !this.reduced ? this.flat.slice() : init.slice();
    this.layout = null;
    this.layoutDone = false;
    this.sizes = new Float32Array(n);
    for (let i = 0; i < n; i++) this.sizes[i] = 3.2 + Math.min(11, Math.sqrt(data.nodes[i]!.degree) * 2.1);
    this.sx = new Float32Array(n);
    this.sy = new Float32Array(n);
    this.sd = new Float32Array(n);
    this.sr = new Float32Array(n);
    this.hover = -1;
    this.shown.clear();
    this.buildGeometry();
    this.resolveActive();
    this.resolveSuggestion();
    this.refreshState();
    if (first) this.fit(true);
    this.startLayout(init, reused > n * 0.6);
    this.request();
  }

  setPalette(p: CanvasPalette): void {
    const c = this.colorCtx;
    const bg = cssRgb(c, backgroundOf(this.host), [0.08, 0.08, 0.1]);
    const dark = 0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2] < 0.5;
    const v = (col: string, fb: [number, number, number]) => new Vector3(...cssRgb(c, col, fb));
    const u = this.nodeMat.uniforms;
    u.uNode!.value = v(p.node, [0.78, 0.78, 0.8]);
    u.uAccent!.value = v(p.accent, [0.39, 0.4, 0.95]);
    u.uInk!.value = v(p.accentInk, [0.65, 0.7, 0.99]);
    u.uBg!.value = new Vector3(...bg);
    u.uDark!.value = dark ? 1 : 0;
    const e = this.edgeMat.uniforms;
    e.uEdge!.value = v(p.muted, [0.6, 0.62, 0.68]);
    e.uInk!.value = v(p.accentInk, [0.65, 0.7, 0.99]);
    this.edgeMat.blending = dark ? AdditiveBlending : NormalBlending;
    this.edgeMat.needsUpdate = true;
    this.edgeBase = dark ? 0.17 : 0.3;
    this.updateEdgeAlpha();
    const acc = cssRgb(c, p.accentInk, [0.65, 0.7, 0.99]);
    (this.suggestLine.material as LineDashedMaterial).color.setRGB(acc[0], acc[1], acc[2], SRGBColorSpace);
    this.request();
  }

  setActive(id: string | null): void {
    this.activeId = id;
    this.resolveActive();
    this.refreshState();
    this.request();
  }

  setSuggestion(pair: [string, string] | null, open: boolean): void {
    this.suggestion = pair;
    this.suggestionOpen = open;
    this.resolveSuggestion();
    this.request();
  }

  setMode(mode: GraphMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.target = mode === "2d" ? this.flat.slice() : (this.layout ?? initPositions(this.nodes, this.known).init).slice();
    if (this.reduced) this.pos.set(this.target);
    this.applyMode();
    if (this.nodes.length) this.fit();
    this.request();
  }

  setReducedMotion(on: boolean): void {
    this.reduced = on;
    this.controls.enableDamping = !on;
  }

  zoomBy(f: number): void {
    const dir = this.camera.position.clone().sub(this.controls.target);
    const dist = Math.max(this.controls.minDistance, Math.min(this.controls.maxDistance, dir.length() / f));
    dir.setLength(dist);
    this.flyTo(this.controls.target.clone(), this.controls.target.clone().add(dir), 320);
  }

  fit(instant = false): void {
    const { center, r } = this.bounds();
    const halfV = (FOV * Math.PI) / 360;
    const halfH = Math.atan(Math.tan(halfV) * this.camera.aspect);
    // Some air around the sphere: the HUDs float over the edges of the stage.
    const dist = (r / Math.sin(Math.min(halfV, halfH))) * 1.22;
    this.fitDist = dist;
    const dir = this.mode === "2d" ? new Vector3(0, 0, 1) : this.camera.position.clone().sub(this.controls.target);
    // 3D from the front (first view, or back from 2D): a slight tilt shows the depth.
    if (this.mode === "3d" && (dir.lengthSq() < 1e-6 || instant || Math.abs(dir.clone().normalize().z) > 0.995)) dir.set(0.32, 0.22, 1);
    dir.setLength(dist);
    const toPos = center.clone().add(dir);
    if (instant || this.reduced) {
      this.fly = null;
      this.controls.target.copy(center);
      this.camera.position.copy(toPos);
      this.controls.update();
    } else this.flyTo(center, toPos, FLY_MS);
    this.touched = false;
    this.request();
  }

  centerOn(id: string): void {
    const i = this.nodes.findIndex((x) => x.id === id);
    if (i >= 0) this.focusNode(i);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    if (this.movingTimer) clearTimeout(this.movingTimer);
    this.worker?.terminate();
    this.ro.disconnect();
    const cv = this.renderer.domElement;
    cv.removeEventListener("pointerdown", this.onDown);
    cv.removeEventListener("pointermove", this.onMove);
    cv.removeEventListener("pointerup", this.onUp);
    cv.removeEventListener("pointerleave", this.onLeave);
    cv.removeEventListener("contextmenu", this.onContext, true);
    cv.removeEventListener("dblclick", this.onDbl);
    this.controls.dispose();
    this.points?.geometry.dispose();
    this.lines?.geometry.dispose();
    this.suggestLine.geometry.dispose();
    (this.suggestLine.material as LineDashedMaterial).dispose();
    this.nodeMat.dispose();
    this.edgeMat.dispose();
    this.renderer.dispose();
    cv.remove();
    this.overlay.remove();
    this.host.removeAttribute("data-moving");
  }

  // --- Geometry ---------------------------------------------------------------------------------

  private edgeBase = 0.26;

  private updateEdgeAlpha() {
    const m = this.edges.length;
    this.edgeMat.uniforms.uAlpha!.value = this.edgeBase * Math.min(1, 1.6 / Math.sqrt(Math.max(1, m / 700)));
  }

  private buildGeometry() {
    if (this.points) {
      this.scene.remove(this.points);
      this.points.geometry.dispose();
    }
    if (this.lines) {
      this.scene.remove(this.lines);
      this.lines.geometry.dispose();
    }
    const n = this.nodes.length;
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(this.pos, 3));
    g.setAttribute("aSize", new BufferAttribute(this.sizes, 1));
    g.setAttribute("aState", new BufferAttribute(new Float32Array(n), 1));
    const shape = new Float32Array(n);
    for (let i = 0; i < n; i++) shape[i] = shapeOf(this.nodes[i]!.type) === "square" ? 1 : 0;
    g.setAttribute("aShape", new BufferAttribute(shape, 1));
    this.points = new Points(g, this.nodeMat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 1;

    const m = this.edges.length;
    this.edgeIdx = new Uint32Array(m * 2);
    const kind = new Float32Array(m * 2);
    const strong = KIND_BIT.related | KIND_BIT.wiki;
    this.edges.forEach((e, k) => {
      this.edgeIdx[k * 2] = e[0];
      this.edgeIdx[k * 2 + 1] = e[1];
      const kd = e[2] & strong ? 0 : e[2] & KIND_BIT.semantic ? 1 : 2;
      kind[k * 2] = kd;
      kind[k * 2 + 1] = kd;
    });
    const lg = new BufferGeometry();
    lg.setAttribute("position", new BufferAttribute(new Float32Array(m * 6), 3));
    lg.setAttribute("aState", new BufferAttribute(new Float32Array(m * 2), 1));
    lg.setAttribute("aKind", new BufferAttribute(kind, 1));
    this.lines = new LineSegments(lg, this.edgeMat);
    this.lines.frustumCulled = false;
    this.scene.add(this.lines);
    this.scene.add(this.points);
    this.updateEdgeAlpha();
    this.syncEdges();
  }

  private syncEdges() {
    if (!this.lines) return;
    const attr = this.lines.geometry.getAttribute("position") as BufferAttribute;
    const out = attr.array as Float32Array;
    const p = this.pos;
    const idx = this.edgeIdx;
    for (let v = 0; v < idx.length; v++) {
      const s = idx[v]! * 3;
      out[v * 3] = p[s]!;
      out[v * 3 + 1] = p[s + 1]!;
      out[v * 3 + 2] = p[s + 2]!;
    }
    attr.needsUpdate = true;
    if (this.points) (this.points.geometry.getAttribute("position") as BufferAttribute).needsUpdate = true;
    if (this.suggestionIdx) {
      const [a, b] = this.suggestionIdx;
      const sa = this.suggestLine.geometry.getAttribute("position") as BufferAttribute;
      const arr = sa.array as Float32Array;
      arr.set(p.subarray(a * 3, a * 3 + 3), 0);
      arr.set(p.subarray(b * 3, b * 3 + 3), 3);
      sa.needsUpdate = true;
      this.suggestLine.computeLineDistances();
    }
  }

  private resolveActive() {
    this.active = this.activeId ? this.nodes.findIndex((x) => x.id === this.activeId) : -1;
  }

  private resolveSuggestion() {
    const s = this.suggestion;
    const a = s ? this.nodes.findIndex((x) => x.id === s[0]) : -1;
    const b = s ? this.nodes.findIndex((x) => x.id === s[1]) : -1;
    this.suggestionIdx = a >= 0 && b >= 0 ? [a, b] : null;
    this.suggestLine.visible = !!this.suggestionIdx;
    if (this.suggestionIdx) this.syncEdges();
  }

  /** Node / edge states for the focused node (hover, else the open note). */
  private refreshState() {
    const f = this.hover >= 0 ? this.hover : this.active;
    this.focus = f;
    if (!this.points || !this.lines) return;
    const st = this.points.geometry.getAttribute("aState") as BufferAttribute;
    const s = st.array as Float32Array;
    s.fill(0);
    if (f >= 0) {
      for (const j of this.adj[f] ?? []) s[j] = 1;
      s[f] = 2;
    }
    if (this.active >= 0) s[this.active] = 3;
    st.needsUpdate = true;
    const et = this.lines.geometry.getAttribute("aState") as BufferAttribute;
    const e = et.array as Float32Array;
    const idx = this.edgeIdx;
    for (let k = 0; k < idx.length; k += 2) {
      const on = f >= 0 && (idx[k] === f || idx[k + 1] === f) ? 1 : 0;
      e[k] = on;
      e[k + 1] = on;
    }
    et.needsUpdate = true;
  }

  // --- Layout -----------------------------------------------------------------------------------

  private startLayout(init: Float32Array, warm: boolean) {
    const n = this.nodes.length;
    if (n < 2) {
      this.layout = init;
      this.layoutDone = true;
      return;
    }
    if (!this.worker) {
      try {
        this.worker = new Worker(new URL("./layout3d.worker.ts", import.meta.url));
        this.worker.onmessage = (ev: MessageEvent<LayoutReply>) => this.onLayout(ev.data);
      } catch {
        this.layout = init;
        this.layoutDone = true;
        return;
      }
    }
    const token = ++this.token;
    const req = layoutRequest(n, this.edges, init.slice(), warm, token);
    this.worker.postMessage(req, [req.init.buffer, req.edges.buffer, req.weights.buffer, req.degree.buffer]);
  }

  private onLayout(r: LayoutReply) {
    if (this.disposed || r.token !== this.token || r.positions.length !== this.nodes.length * 3) return;
    this.layout = r.positions;
    if (r.done) this.layoutDone = true;
    if (this.mode !== "3d") return;
    // Reduced motion: no visible settling, the finished layout appears at once.
    if (this.reduced && !r.done) return;
    this.target = r.positions;
    if (this.reduced) this.pos.set(r.positions);
    if (r.done && !this.touched) this.fit(this.reduced);
    this.request();
  }

  // --- Camera -----------------------------------------------------------------------------------

  /** Mouse and touch mapping of the mode: 3D orbits with the left button, 2D pans. */
  private applyMode() {
    const c = this.controls;
    const flat = this.mode === "2d";
    c.enableRotate = !flat;
    c.screenSpacePanning = true;
    c.mouseButtons = { LEFT: flat ? MOUSE.PAN : MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN };
    c.touches = { ONE: flat ? TOUCH.PAN : TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN };
  }

  private bounds(): { center: Vector3; r: number } {
    const p = this.mode === "2d" ? this.flat : this.layoutDone && this.layout ? this.layout : this.target;
    const n = this.nodes.length;
    if (!n) return { center: new Vector3(), r: this.radius };
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let i = 0; i < n; i++) {
      cx += p[i * 3]!;
      cy += p[i * 3 + 1]!;
      cz += p[i * 3 + 2]!;
    }
    const center = new Vector3(cx / n, cy / n, cz / n);
    // 96th percentile radius: a few far islands should not shrink the whole picture.
    const d: number[] = [];
    for (let i = 0; i < n; i++) d.push(Math.hypot(p[i * 3]! - center.x, p[i * 3 + 1]! - center.y, p[i * 3 + 2]! - center.z));
    d.sort((a, b) => a - b);
    const r = Math.max(30, d[Math.min(n - 1, Math.floor(n * 0.96))]! + 12);
    return { center, r };
  }

  private flyTo(toTarget: Vector3, toPos: Vector3, ms: number) {
    if (this.reduced) {
      this.fly = null;
      this.controls.target.copy(toTarget);
      this.camera.position.copy(toPos);
      this.controls.update();
      this.request();
      return;
    }
    this.fly = { elapsed: 0, ms, fromPos: this.camera.position.clone(), toPos, fromTarget: this.controls.target.clone(), toTarget };
    this.request();
  }

  /** Click on a node: fly in close enough to read its neighbourhood. */
  private focusNode(i: number) {
    const p = new Vector3(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
    const dir = this.camera.position.clone().sub(this.controls.target);
    const dist = Math.min(dir.length(), Math.max(90, this.radius * 0.8));
    dir.setLength(dist);
    this.touched = true;
    this.flyTo(p, p.clone().add(dir), FLY_MS);
  }

  private select(i: number) {
    this.focusNode(i);
    this.opts.onOpen(this.nodes[i]!.id);
  }

  // --- Pointer ----------------------------------------------------------------------------------

  private local(e: { clientX: number; clientY: number }) {
    const r = this.host.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onDown = (e: PointerEvent) => {
    this.down = { ...this.local(e), button: e.button };
    this.dragging = true;
  };

  private onMove = (e: PointerEvent) => {
    this.pointer = this.local(e);
    if (this.down && Math.hypot(this.pointer.x - this.down.x, this.pointer.y - this.down.y) > 4 && this.hover >= 0) this.setHover(-1);
    this.request();
  };

  private onUp = (e: PointerEvent) => {
    const d = this.down;
    this.down = null;
    this.dragging = false;
    if (!d || d.button !== 0) return;
    const p = this.local(e);
    if (Math.hypot(p.x - d.x, p.y - d.y) > 4) return;
    const i = this.pick(p.x, p.y);
    if (i >= 0) this.select(i);
  };

  private onLeave = () => {
    this.pointer = null;
    this.setHover(-1);
  };

  private onContext = (e: MouseEvent) => {
    const p = this.local(e);
    const i = this.pick(p.x, p.y);
    if (i < 0) return;
    e.preventDefault();
    e.stopPropagation();
    this.opts.onMenu(this.nodes[i]!.id, { x: e.clientX, y: e.clientY });
  };

  private onDbl = (e: MouseEvent) => {
    const p = this.local(e);
    if (this.pick(p.x, p.y) < 0) this.fit();
  };

  private setHover(i: number) {
    if (i === this.hover) return;
    this.hover = i;
    this.renderer.domElement.style.cursor = i >= 0 ? "pointer" : "";
    this.refreshState();
    this.request();
  }

  /** Node under a screen point (CSS px): its dot or its label, the one nearest the camera. */
  private pick(x: number, y: number): number {
    for (const l of this.placed) {
      const wdt = this.widths[l.i]!;
      if (x >= l.x && x <= l.x + wdt && y >= l.y && y <= l.y + 20) return l.i;
    }
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < this.nodes.length; i++) {
      const d = this.sd[i]!;
      if (d <= 0) continue;
      const rr = Math.max(7, this.sr[i]! + 3);
      const dx = this.sx[i]! - x;
      const dy = this.sy[i]! - y;
      if (dx * dx + dy * dy > rr * rr) continue;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  // --- Frame loop -------------------------------------------------------------------------------

  private request() {
    if (!this.raf && !this.disposed) this.raf = requestAnimationFrame(this.frame);
  }

  private markMoving() {
    if (!this.moving) {
      this.moving = true;
      this.host.setAttribute("data-moving", "");
    }
    if (this.movingTimer) clearTimeout(this.movingTimer);
    this.movingTimer = setTimeout(() => {
      this.moving = false;
      this.host.removeAttribute("data-moving");
    }, 180);
  }

  private resize() {
    const r = this.host.getBoundingClientRect();
    this.w = Math.max(1, Math.round(r.width));
    this.h = Math.max(1, Math.round(r.height));
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(this.w, this.h, false);
    this.camera.aspect = this.w / this.h;
    this.camera.updateProjectionMatrix();
    this.nodeMat.uniforms.uScale!.value = (this.h * this.dpr) / (2 * Math.tan((FOV * Math.PI) / 360));
    this.nodeMat.uniforms.uMinPx!.value = 2.2 * this.dpr;
    this.request();
  }

  private frame = (t: number) => {
    this.raf = 0;
    if (this.disposed) return;
    const dt = Math.min(0.05, Math.max(0.001, (t - (this.last || t - 16)) / 1000));
    this.last = t;
    let busy = false;

    // Ease the nodes toward the layout (frame-rate independent).
    const n = this.nodes.length;
    if (n && this.pos !== this.target) {
      const a = 1 - Math.exp(-dt * 5.5);
      let maxD = 0;
      const p = this.pos;
      const q = this.target;
      for (let k = 0; k < n * 3; k++) {
        const d = q[k]! - p[k]!;
        if (d > maxD) maxD = d;
        else if (-d > maxD) maxD = -d;
        p[k] = p[k]! + d * a;
      }
      if (maxD < 0.02) p.set(q);
      if (maxD > 0) this.syncEdges();
      if (maxD >= 0.02) busy = true;
    }

    if (this.fly) {
      const f = this.fly;
      f.elapsed += Math.min(34, dt * 1000);
      const k = Math.min(1, f.elapsed / f.ms);
      const e = ease(k);
      this.controls.target.lerpVectors(f.fromTarget, f.toTarget, e);
      this.camera.position.lerpVectors(f.fromPos, f.toPos, e);
      this.markMoving();
      if (k >= 1) this.fly = null;
      busy = true;
    }
    if (this.controls.update(dt)) busy = true;

    const goal = this.focus >= 0 ? 1 : 0;
    if (this.dim !== goal) {
      this.dim = this.reduced ? goal : goal > this.dim ? Math.min(goal, this.dim + dt * 7) : Math.max(goal, this.dim - dt * 5);
      busy = true;
    }
    this.nodeMat.uniforms.uDim!.value = this.dim;
    this.edgeMat.uniforms.uDim!.value = this.dim;

    // Depth fog around the orbit target.
    const dist = this.camera.position.distanceTo(this.controls.target);
    const fogNear = Math.max(1, dist - this.radius * 0.15);
    const fogFar = dist + this.radius * 1.9;
    this.nodeMat.uniforms.uFogNear!.value = fogNear;
    this.nodeMat.uniforms.uFogFar!.value = fogFar;
    this.edgeMat.uniforms.uFogNear!.value = fogNear;
    this.edgeMat.uniforms.uFogFar!.value = fogFar;

    this.renderer.render(this.scene, this.camera);
    this.project();
    if (this.pointer && !this.dragging) this.setHover(this.pick(this.pointer.x, this.pointer.y));
    this.drawLabels(fogNear, fogFar);

    const zoom = (this.fitDist / Math.max(1, dist)).toFixed(2);
    if (zoom !== this.zoomShown) {
      this.zoomShown = zoom;
      this.host.dataset.zoom = zoom;
    }
    if (busy) this.request();
  };

  /** Screen position (CSS px), camera depth and on-screen radius of every node. */
  private project() {
    const n = this.nodes.length;
    this.camera.updateMatrixWorld();
    const v = this.camera.matrixWorldInverse.elements;
    const pr = this.camera.projectionMatrix.elements;
    const p = this.pos;
    const hw = this.w / 2;
    const hh = this.h / 2;
    const scale = this.h / (2 * Math.tan((FOV * Math.PI) / 360));
    for (let i = 0; i < n; i++) {
      const x = p[i * 3]!;
      const y = p[i * 3 + 1]!;
      const z = p[i * 3 + 2]!;
      const cx = v[0]! * x + v[4]! * y + v[8]! * z + v[12]!;
      const cy = v[1]! * x + v[5]! * y + v[9]! * z + v[13]!;
      const cz = v[2]! * x + v[6]! * y + v[10]! * z + v[14]!;
      const depth = -cz;
      this.sd[i] = depth;
      if (depth <= 1) continue;
      const ndcX = (pr[0]! * cx + pr[8]! * cz) / depth;
      const ndcY = (pr[5]! * cy + pr[9]! * cz) / depth;
      this.sx[i] = (ndcX + 1) * hw;
      this.sy[i] = (1 - ndcY) * hh;
      this.sr[i] = (this.sizes[i]! * scale) / depth / 2;
    }
  }

  private drawLabels(fogNear: number, fogFar: number) {
    const n = this.nodes.length;
    const cands: LabelCandidate[] = [];
    const add = (i: number, priority: number) => {
      if (i < 0 || i >= n || this.sd[i]! <= 1) return;
      cands.push({ i, x: this.sx[i]!, y: this.sy[i]!, r: Math.max(3, this.sr[i]!), priority, width: this.widths[i]! });
    };
    const forced = new Set<number>();
    const f = this.focus;
    if (this.active >= 0) {
      add(this.active, 3e6);
      forced.add(this.active);
    }
    if (f >= 0 && f !== this.active) {
      add(f, 2.9e6);
      forced.add(f);
    }
    const force = (i: number, priority: number) => {
      if (forced.has(i)) return;
      add(i, priority);
      forced.add(i);
    };
    if (this.suggestionIdx) for (const i of this.suggestionIdx) force(i, 2e6);
    if (f >= 0) for (const j of this.adj[f] ?? []) force(j, 1e6 + this.nodes[j]!.degree);
    // Nearest nodes: big on screen first; already shown ones keep their place (no flicker).
    const general: LabelCandidate[] = [];
    for (let i = 0; i < n; i++) {
      if (forced.has(i) || this.sd[i]! <= 1) continue;
      const r = this.sr[i]!;
      if (r < 2.6) continue;
      const x = this.sx[i]!;
      const y = this.sy[i]!;
      if (x < -40 || x > this.w || y < -20 || y > this.h + 20) continue;
      general.push({ i, x, y, r: Math.max(3, r), priority: r * 6 + Math.sqrt(this.nodes[i]!.degree) * 8 + (this.shown.has(i) ? 14 : 0), width: this.widths[i]! });
    }
    general.sort((a, b) => b.priority - a.priority);
    for (const c of general.slice(0, 160)) cands.push(c);

    // Few labels in the overview (the hubs), more the closer the camera gets.
    const zoom = this.fitDist / Math.max(1, this.camera.position.distanceTo(this.controls.target));
    // With a focused node its neighbourhood speaks; only a few other labels stay for orientation.
    const budget = Math.round(Math.min(f >= 0 ? 8 : MAX_LABELS, Math.max(8, 9 * zoom * zoom)));
    const placed = placeLabels(cands, this.w, this.h, Math.min(POOL, forced.size + budget));
    this.placed = placed;
    const next = new Set(placed.map((l) => l.i));
    this.shown = next;

    // Keep a node in the same slot while it stays labelled: no text rewrites, no restarts of the fade.
    const free: Slot[] = [];
    const bySlot = new Map<number, Slot>();
    for (const s of this.slots) {
      if (s.i >= 0 && next.has(s.i)) bySlot.set(s.i, s);
      else free.push(s);
    }
    for (const l of placed) {
      let s = bySlot.get(l.i);
      if (!s) {
        s = free.pop()!;
        if (!s) break;
        s.i = l.i;
        s.text.data = this.labels[l.i]!;
        s.el.title = this.nodes[l.i]!.label;
        s.el.setAttribute("aria-label", this.nodes[l.i]!.label);
        s.el.tabIndex = 0;
        s.el.hidden = false;
        s.o = NaN;
        bySlot.set(l.i, s);
      }
      const x = Math.round(l.x - 14);
      const y = Math.round(l.y);
      if (x !== s.x || y !== s.y) {
        s.el.style.transform = `translate3d(${x}px,${y}px,0)`;
        s.x = x;
        s.y = y;
      }
      const fog = Math.min(1, Math.max(0, (this.sd[l.i]! - fogNear) / Math.max(1, fogFar - fogNear)));
      const lit = this.focus >= 0 && !forced.has(l.i) ? 0.45 : 1;
      const o = Math.round((1 - fog * 0.75) * lit * 20) / 20;
      if (o !== s.o) {
        s.el.style.opacity = String(o);
        s.o = o;
      }
      const cls = l.i === this.active ? "is-active" : forced.has(l.i) ? "is-lit" : "";
      if (cls !== s.cls) {
        s.el.className = `gr-label kx-node${cls ? ` ${cls}` : ""}${shapeOf(this.nodes[l.i]!.type) === "square" ? " is-square" : ""}`;
        s.cls = cls;
      }
    }
    for (const s of free) {
      if (s.i < 0 || next.has(s.i)) continue;
      s.i = -1;
      s.el.hidden = true;
      s.el.tabIndex = -1;
    }

    // "Neue Verbindung?" at the middle of the suggestion line.
    const sug = this.suggestionIdx;
    if (sug && this.suggestionOpen && this.sd[sug[0]]! > 1 && this.sd[sug[1]]! > 1) {
      const x = Math.round((this.sx[sug[0]]! + this.sx[sug[1]]!) / 2);
      const y = Math.round((this.sy[sug[0]]! + this.sy[sug[1]]!) / 2);
      this.linkBtn.hidden = false;
      this.linkBtn.style.transform = `translate3d(${x}px,${y}px,0) translate(-50%,-50%)`;
    } else this.linkBtn.hidden = true;
  }
}
