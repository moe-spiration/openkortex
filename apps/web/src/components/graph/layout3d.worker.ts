/// <reference lib="webworker" />
import { forceCenter, forceLink, forceManyBody, forceSimulation, forceX, forceY, forceZ } from "d3-force-3d";
import { LAYOUT_BUDGET_MS, layoutTicks, type LayoutReply, type LayoutRequest } from "./layout3d";

/*
 * 3D force layout of the graph, off the main thread (d3-force-3d, Barnes–Hut octree). A warmup runs
 * silently, then positions are posted about every 120 ms until the simulation cools down; the
 * renderer eases its nodes toward each post, so the motion stays calm instead of jittering.
 */

interface SimNode {
  index?: number;
  x: number;
  y: number;
  z: number;
}

let run = 0;

self.onmessage = (ev: MessageEvent<LayoutRequest>) => {
  const req = ev.data;
  const id = ++run;
  const { n, init, edges, weights, degree } = req;
  const total = layoutTicks(n);
  const nodes: SimNode[] = Array.from({ length: n }, (_, i) => ({ x: init[i * 3]!, y: init[i * 3 + 1]!, z: init[i * 3 + 2]! }));
  const links = Array.from({ length: edges.length / 2 }, (_, k) => ({ source: edges[k * 2]!, target: edges[k * 2 + 1]!, w: weights[k]! }));
  const spread = Math.sqrt(n);
  const sim = forceSimulation(nodes, 3)
    .stop()
    .alpha(req.warm ? 0.35 : 1)
    .alphaDecay(1 - Math.pow(0.001, 1 / total))
    .velocityDecay(0.42)
    .force(
      "link",
      forceLink(links)
        .distance((l: { w: number }) => 26 + (100 - l.w) * 0.22)
        .strength((l: { source: SimNode; target: SimNode; w: number }) => {
          const d = Math.min(degree[l.source.index!] ?? 1, degree[l.target.index!] ?? 1);
          return (0.35 + l.w / 250) / Math.max(1, d);
        }),
    )
    // theta 1.2: coarser far field, a third cheaper than 0.9 and invisible at this density.
    .force("charge", forceManyBody().strength(-48).theta(1.2).distanceMax(60 * spread + 200))
    .force("center", forceCenter(0, 0, 0))
    // A gentle pull to the origin keeps loose islands inside one sphere instead of drifting off.
    .force("x", forceX(0).strength(0.035))
    .force("y", forceY(0).strength(0.035))
    .force("z", forceZ(0).strength(0.035));

  const out = new Float32Array(n * 3);
  const post = (done: boolean) => {
    for (let i = 0; i < n; i++) {
      const p = nodes[i]!;
      out[i * 3] = p.x;
      out[i * 3 + 1] = p.y;
      out[i * 3 + 2] = p.z;
    }
    const msg: LayoutReply = { token: req.token, positions: out.slice(), done };
    (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, [msg.positions.buffer]);
  };

  const started = performance.now();
  // Warmup: the first, most chaotic ticks never reach the screen.
  const warmup = req.warm ? 0 : Math.round(total * 0.2);
  for (let t = 0; t < warmup && performance.now() - started < LAYOUT_BUDGET_MS / 3; t++) sim.tick();
  post(false);

  let ticks = warmup;
  const step = () => {
    if (id !== run) return; // a newer graph replaced this one
    const until = performance.now() + 120;
    while (performance.now() < until && ticks < total && sim.alpha() > sim.alphaMin()) {
      sim.tick();
      ticks++;
    }
    const done = ticks >= total || sim.alpha() <= sim.alphaMin() || performance.now() - started > LAYOUT_BUDGET_MS;
    post(done);
    if (!done) setTimeout(step, 0);
  };
  setTimeout(step, 0);
};
