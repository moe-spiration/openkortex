/*
 * Software rendering → solid glass (fx2-perf finding). Without GPU rasterisation (WebView2 or a browser with the GPU off,
 * remote desktop, a VM) every backdrop-filter blur is painted on the CPU: on Home that alone cost ~200 ms per keystroke.
 * The look stays the same as "Transparenz reduzieren": data-glass="solid" swaps the blur for the solid surface.
 *
 * The probe asks WebGL for its renderer once per device, after the first paint (idle), and stores the answer; the
 * pre-paint script (lib/shell/prefs.ts) reads it, so later starts paint solid from the first frame.
 */

export const GPU_KEY = "kortex.gpu.v1";
export type GpuProbe = "soft" | "hw";

/** Renderer strings of software rasterisers: SwiftShader (Chrome/Edge without GPU), llvmpipe, WARP / Basic Render Driver. */
const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic|warp/i;

/** Result of a WebGL probe: no WebGL at all counts as software rendering. */
export function classifyRenderer(renderer: string | null): GpuProbe {
  if (renderer === null) return "soft";
  return SOFTWARE.test(renderer) ? "soft" : "hw";
}

/** The stored probe ("soft" means: paint glass solid). */
export function readGpuProbe(): GpuProbe | null {
  try {
    const v = localStorage.getItem(GPU_KEY);
    return v === "soft" || v === "hw" ? v : null;
  } catch {
    return null;
  }
}

/** WebGL renderer string of this browser, or null without WebGL. */
function webglRenderer(): string | null {
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl") ?? canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!gl) return null;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? "");
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return name;
  } catch {
    return null;
  }
}

/**
 * Probes once per device (re-probes when nothing is stored) in idle time and stores the result. `onChange` runs when the
 * answer differs from the stored one, so the caller can re-apply the appearance attributes.
 */
export function probeGpuWhenIdle(onChange: (probe: GpuProbe) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const run = () => {
    const probe = classifyRenderer(webglRenderer());
    if (probe === readGpuProbe()) return;
    try {
      localStorage.setItem(GPU_KEY, probe);
    } catch {
      /* private mode: probe again next start */
    }
    onChange(probe);
  };
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
  if (w.requestIdleCallback) {
    const id = w.requestIdleCallback(run, { timeout: 3000 });
    return () => w.cancelIdleCallback?.(id);
  }
  const t = setTimeout(run, 1500);
  return () => clearTimeout(t);
}
