/* Minimal typings of the parts of d3-force-3d the layout worker uses (the package ships none). */
declare module "d3-force-3d" {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  type Accessor<T> = number | ((d: T, i: number) => number);
  interface Force {
    (alpha: number): void;
  }
  interface Simulation<N> {
    tick(iterations?: number): this;
    stop(): this;
    alpha(): number;
    alpha(a: number): this;
    alphaMin(): number;
    alphaMin(a: number): this;
    alphaDecay(d: number): this;
    velocityDecay(d: number): this;
    force(name: string, f: Force | null): this;
    nodes(): N[];
  }
  interface LinkForce<L> extends Force {
    distance(d: Accessor<L>): this;
    strength(s: Accessor<L>): this;
  }
  interface ManyBody extends Force {
    strength(s: Accessor<any>): this;
    theta(t: number): this;
    distanceMax(d: number): this;
  }
  interface Positional extends Force {
    strength(s: Accessor<any>): this;
  }
  export function forceSimulation<N>(nodes: N[], numDimensions?: 1 | 2 | 3): Simulation<N>;
  export function forceLink<L>(links: L[]): LinkForce<any>;
  export function forceManyBody(): ManyBody;
  export function forceCenter(x?: number, y?: number, z?: number): Force;
  export function forceX(x?: number): Positional;
  export function forceY(y?: number): Positional;
  export function forceZ(z?: number): Positional;
}
