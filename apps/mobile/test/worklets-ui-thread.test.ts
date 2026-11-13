import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { PTT_DISCARD, PTT_NONE, PTT_SAVE, PTT_SLOP } from "../src/capture/pttDrop";

/*
 * The other tests run worklets as plain JS. On the phone they run as the code string the worklet compiler
 * emits, with captured variables unpacked from `this.__closure` inside the body. A default parameter that
 * names a captured variable is evaluated before that unpacking and throws on the UI thread, which crashes the
 * app (0.6.2: holding the orb). These tests compile the real sources with the same plugin Metro uses.
 */

const req = createRequire(import.meta.url);
const pluginPath = req.resolve("react-native-worklets/plugin");
// @babel/core comes with the worklets plugin (Metro's own copy); typed by hand, it is no direct dependency.
const babel = createRequire(pluginPath)("@babel/core") as { transformSync: (code: string, opts: Record<string, unknown>) => { code?: string | null } | null };

type Worklet = { name: string; params: string; code: string };

const compiled = new Map<string, string>();
function transform(file: string): string {
  let code = compiled.get(file);
  if (code === undefined) {
    const out = babel.transformSync(readFileSync(file, "utf8"), {
      filename: file,
      babelrc: false,
      configFile: false,
      parserOpts: { plugins: ["typescript", "jsx"] },
      plugins: [pluginPath],
    });
    code = out?.code ?? "";
    compiled.set(file, code);
  }
  return code;
}

function compile(file: string): Worklet[] {
  const list: Worklet[] = [];
  for (const m of transform(file).matchAll(/code: (".*?(?<!\\)"),\n/g)) {
    const code = JSON.parse(m[1]!) as string;
    const head = /^\(function (\w+)\(([^)]*)\)/.exec(code);
    if (head) list.push({ name: head[1]!, params: head[2]!, code });
  }
  return list;
}

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []));

const root = join(__dirname, "..");

describe("worklets on the UI thread", () => {
  it("have no default parameters (they cannot see captured variables)", () => {
    const bad = [...walk(join(root, "src")), ...walk(join(root, "app"))].flatMap((f) => compile(f).filter((w) => w.params.includes("=")).map((w) => `${f}: ${w.name}(${w.params})`));
    expect(bad).toEqual([]);
  }, 60_000);

  it("call only worklets of our own code (a plain JS function called on the UI thread crashes the app)", () => {
    // Our own functions a worklet calls directly (not through runOnJS) must be worklets themselves. Library
    // imports (withTiming, Math, ...) are out of scope; a same-file or relative import is checked.
    const resolveImport = (from: string, spec: string) => {
      const base = join(dirname(from), spec);
      return [".ts", ".tsx", "/index.ts", "/index.tsx"].map((x) => base + x).find((f) => existsSync(f));
    };
    const bad: string[] = [];
    for (const f of [...walk(join(root, "src")), ...walk(join(root, "app"))]) {
      const src = readFileSync(f, "utf8");
      const imports = new Map<string, string>();
      for (const [, names = "", spec = ""] of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*"(\.[^"]+)"/g))
        for (const n of names.split(",")) {
          const name = n.trim().split(/\s+as\s+/).pop()!;
          if (name && !/^type\s/.test(n.trim())) imports.set(name, spec);
        }
      for (const w of compile(f)) {
        const cap = /const\[([^\]]*)\]=this\.__closure/.exec(w.code)?.[1]?.split(",") ?? [];
        for (const n of cap) {
          if (!new RegExp(`(?<![\\w.$])${n}\\(`).test(w.code)) continue; // not called directly
          const spec = imports.get(n);
          const home = spec ? resolveImport(f, spec) : f;
          if (!home) continue;
          const out = transform(home);
          const isFn = new RegExp(`(function ${n}\\b|const ${n} = )`).test(out);
          const isWorklet = out.includes(`${n}.__workletHash`) || new RegExp(`const ${n} = function \\w+Factory\\(`).test(out);
          if (isFn && !isWorklet) bad.push(`${f}: ${w.name} calls ${n}`);
        }
      }
    }
    expect(bad).toEqual([]);
  }, 60_000);

  it("push-to-talk hit test runs as compiled UI-thread code", () => {
    const ws = compile(join(root, "src/capture/pttDrop.ts"));
    const run = (name: string, closure: unknown[]) => {
      const w = ws.find((x) => x.name.startsWith(name + "_"));
      if (!w) throw new Error(`worklet ${name} not found`);
      // Same shape as on the device: the function sees its captures only through this.__closure.
      const fn = new Function(`return ${w.code}`)() as (...a: unknown[]) => unknown;
      return (...a: unknown[]) => fn.apply({ __closure: closure }, a);
    };
    const inside = run("inside", []);
    const cap = /const\[([^\]]*)\]=this\.__closure/.exec(ws.find((w) => w.name.startsWith("pttDropTarget_"))!.code)![1]!.split(",");
    const values: Record<string, unknown> = { PTT_SLOP, PTT_NONE, PTT_DISCARD, PTT_SAVE, inside };
    const hit = run("pttDropTarget", cap.map((k) => values[k]));
    const rects = [28, 700, 174, 44, 210, 700, 174, 44];
    expect(hit(100, 720, rects)).toBe(PTT_DISCARD);
    expect(hit(300, 720, rects)).toBe(PTT_SAVE);
    expect(hit(100, 692, rects)).toBe(PTT_DISCARD);
    expect(hit(100, 692, rects, 0)).toBe(PTT_NONE);
    expect(hit(100, 600, rects)).toBe(PTT_NONE);
  });
});
