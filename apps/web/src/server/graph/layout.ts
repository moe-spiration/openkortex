import type { GraphData } from "./types";

/*
 * Deterministic force layout (Fruchterman-Reingold repulsion, LinLog attraction) for up to a few thousand nodes.
 * Repulsion only looks at nearby nodes through a uniform grid, so one iteration is O(n) instead of
 * O(n²); 5,000 nodes and 15,000 edges lay out in well under a second. Nodes start on a spiral
 * ordered by degree, in an angular sector per tag domain, so clusters of one theme stay together
 * and the result is the same for the same input.
 */

export interface LayoutOptions {
  iterations?: number;
  /** Ideal edge length in world units. */
  length?: number;
}

const DOMAIN_SECTOR: Record<string, number> = { ai: 0, auto: 1, health: 2, food: 3, finance: 4, strategy: 5 };

/** Writes x / y into the nodes of `graph` (world units, origin near the centre of mass). */
export function layoutGraph(graph: Pick<GraphData, "nodes" | "edges">, opts: LayoutOptions = {}): void {
  const { nodes, edges } = graph;
  const n = nodes.length;
  if (n === 0) return;
  const L = opts.length ?? 46;
  const iterations = opts.iterations ?? (n > 3000 ? 55 : n > 1000 ? 90 : 140);
  const R = L * Math.sqrt(n) * 0.75;

  const x = new Float64Array(n);
  const y = new Float64Array(n);
  // Initial positions: spiral by rank, rotated into the domain's sector.
  nodes.forEach((node, i) => {
    const sector = node.domain ? (DOMAIN_SECTOR[node.domain] ?? 0) : 3;
    const base = (sector / 6) * Math.PI * 2;
    const r = R * Math.sqrt((i + 0.5) / n);
    const a = base + i * 2.399963 * 0.35 + (sector % 2 ? 0.4 : 0);
    x[i] = Math.cos(a) * r;
    y[i] = Math.sin(a) * r;
  });
  if (n === 1) {
    nodes[0]!.x = 0;
    nodes[0]!.y = 0;
    return;
  }

  const m = edges.length;
  const ea = new Int32Array(m);
  const eb = new Int32Array(m);
  const ew = new Float64Array(m);
  edges.forEach((e, k) => {
    ea[k] = e[0];
    eb[k] = e[1];
    ew[k] = 0.35 + (e[3] / 100) * 0.65;
  });

  const dx = new Float64Array(n);
  const dy = new Float64Array(n);
  const cell = L * 2;
  const cellIdx = new Int32Array(n);
  const order = new Int32Array(n);

  for (let it = 0; it < iterations; it++) {
    const temp = R * 0.12 * (1 - it / iterations) + 0.4;
    dx.fill(0);
    dy.fill(0);

    // Uniform grid of the current positions (counting sort, no per-iteration allocations).
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      if (x[i]! < minX) minX = x[i]!;
      if (x[i]! > maxX) maxX = x[i]!;
      if (y[i]! < minY) minY = y[i]!;
      if (y[i]! > maxY) maxY = y[i]!;
    }
    let cs = cell;
    while (((maxX - minX) / cs + 3) * ((maxY - minY) / cs + 3) > 1 << 22) cs *= 2;
    const gw = Math.floor((maxX - minX) / cs) + 3;
    const gh = Math.floor((maxY - minY) / cs) + 3;
    const cellOf = cellIdx;
    const start = new Int32Array(gw * gh + 1);
    for (let i = 0; i < n; i++) {
      const c = (Math.floor((y[i]! - minY) / cs) + 1) * gw + Math.floor((x[i]! - minX) / cs) + 1;
      cellOf[i] = c;
      start[c + 1]!++;
    }
    for (let c = 0; c < gw * gh; c++) start[c + 1] = start[c + 1]! + start[c]!;
    const fill = start.slice(0, gw * gh);
    for (let i = 0; i < n; i++) order[fill[cellOf[i]!]!++] = i;

    for (let i = 0; i < n; i++) {
      const ci = cellOf[i]!;
      for (let off = -gw; off <= gw; off += gw)
        for (let c = ci + off - 1; c <= ci + off + 1; c++) {
          for (let p = start[c]!; p < start[c + 1]!; p++) {
            const j = order[p]!;
            if (j <= i) continue;
            let vx = x[i]! - x[j]!;
            let vy = y[i]! - y[j]!;
            let d2 = vx * vx + vy * vy;
            if (d2 === 0) {
              vx = ((i * 7919) % 13) - 6 || 1;
              vy = ((j * 104729) % 11) - 5 || 1;
              d2 = vx * vx + vy * vy;
            }
            if (d2 > cs * cs) continue;
            const f = (L * L) / d2; // repulsion ~ L² / d along the unit vector
            dx[i] = dx[i]! + vx * f;
            dy[i] = dy[i]! + vy * f;
            dx[j] = dx[j]! - vx * f;
            dy[j] = dy[j]! - vy * f;
          }
        }
    }
    // Springs along edges.
    for (let k = 0; k < m; k++) {
      const a = ea[k]!;
      const b = eb[k]!;
      const vx = x[a]! - x[b]!;
      const vy = y[a]! - y[b]!;
      const d = Math.sqrt(vx * vx + vy * vy) || 0.01;
      const f = (ew[k]! * L * 0.6 * Math.log(1 + d / L)) / d; // LinLog attraction: bounded growth keeps clusters from collapsing
      dx[a] = dx[a]! - vx * f;
      dy[a] = dy[a]! - vy * f;
      dx[b] = dx[b]! + vx * f;
      dy[b] = dy[b]! + vy * f;
    }
    // Gravity keeps separate components in one picture; limit the step by the temperature.
    for (let i = 0; i < n; i++) {
      dx[i] = dx[i]! - x[i]! * 0.012;
      dy[i] = dy[i]! - y[i]! * 0.012;
      const len = Math.sqrt(dx[i]! * dx[i]! + dy[i]! * dy[i]!);
      if (len > 0) {
        const s = Math.min(len, temp) / len;
        x[i] = x[i]! + dx[i]! * s;
        y[i] = y[i]! + dy[i]! * s;
      }
    }
  }

  // Centre on the centroid, round to 0.1.
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += x[i]!;
    sy += y[i]!;
  }
  sx /= n;
  sy /= n;
  nodes.forEach((node, i) => {
    node.x = Math.round((x[i]! - sx) * 10) / 10;
    node.y = Math.round((y[i]! - sy) * 10) / 10;
  });
}
