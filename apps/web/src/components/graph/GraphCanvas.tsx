"use client";

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { GraphData, GraphNode } from "@/server/graph/types";
import type { CanvasPalette } from "./graph-utils";
import type { GraphEngine, GraphMode } from "./graph-engine";
import { t } from "@/i18n";

/** Camera controls for the floating HUDs (Tactile Craft v2): zoom, fit, centre a node. */
export interface GraphControls {
  zoomBy: (f: number) => void;
  fit: () => void;
  centerOn: (id: string) => void;
}

/*
 * Host of the WebGL graph (graph-engine.ts). three.js and the engine are loaded with a dynamic
 * import when the graph mounts, so they stay out of every other route's bundle and the HUDs paint
 * before the 3D code arrives. Props are pushed into the engine imperatively; the engine never
 * causes a React render (camera, hover and labels live outside React).
 */

interface Props {
  data: GraphData;
  palette: CanvasPalette;
  /** Item open in the note drawer: highlighted together with its neighbours. */
  activeId: string | null;
  loading: boolean;
  height: number;
  mode: GraphMode;
  onOpen: (id: string) => void;
  /** Right-click / Shift+F10 on a node. */
  onMenu?: (id: string, at: { x: number; y: number }) => void;
  /** Suggested pair (Serendipity), drawn as a dashed line with a button at its middle. */
  suggestion: [GraphNode, GraphNode] | null;
  suggestionOpen: boolean;
  onLink: () => void;
  controlsRef?: MutableRefObject<GraphControls | null>;
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

export function GraphCanvas({ data, palette, activeId, loading, height, mode, onOpen, onMenu, suggestion, suggestionOpen, onLink, controlsRef }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<GraphEngine | null>(null);
  const [failed, setFailed] = useState(false);
  // Latest callbacks for the engine (created once).
  const cb = useRef({ onOpen, onMenu, onLink });
  cb.current = { onOpen, onMenu, onLink };

  useEffect(() => {
    let cancelled = false;
    let made: GraphEngine | null = null;
    import("./graph-engine")
      .then(({ GraphEngine }) => {
        if (cancelled || !host.current) return;
        made = new GraphEngine(host.current, {
          onOpen: (id) => cb.current.onOpen(id),
          onMenu: (id, at) => cb.current.onMenu?.(id, at),
          onLink: () => cb.current.onLink(),
          reducedMotion: reducedMotion(),
        });
        setEngine(made);
      })
      .catch(() => !cancelled && setFailed(true));
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const onMq = () => made?.setReducedMotion(mq.matches);
    mq?.addEventListener("change", onMq);
    return () => {
      cancelled = true;
      mq?.removeEventListener("change", onMq);
      made?.dispose();
      setEngine(null);
    };
  }, []);

  useEffect(() => engine?.setPalette(palette), [engine, palette]);
  useEffect(() => engine?.setMode(mode), [engine, mode]);
  useEffect(() => engine?.setData(data), [engine, data]);
  useEffect(() => engine?.setActive(activeId), [engine, activeId, data]);
  const sa = suggestion?.[0].id;
  const sb = suggestion?.[1].id;
  useEffect(() => engine?.setSuggestion(sa && sb ? [sa, sb] : null, suggestionOpen), [engine, sa, sb, suggestionOpen, data]);

  useEffect(() => {
    if (!controlsRef || !engine) return;
    controlsRef.current = {
      zoomBy: (f) => engine.zoomBy(f),
      fit: () => engine.fit(),
      centerOn: (id) => engine.centerOn(id),
    };
    return () => {
      controlsRef.current = null;
    };
  }, [controlsRef, engine]);

  return (
    <div
      ref={host}
      role="img"
      className="gr-canvas gr-canvas--3d"
      data-mode={mode}
      aria-busy={loading || !engine}
      aria-label={t("Knowledge graph with {nodes} nodes and {edges} connections", { nodes: data.nodes.length, edges: data.edges.length })}
      style={{ height }}
    >
      {failed && (
        <p className="kx-help gr-fail">{t("The graph view could not be loaded (WebGL not available). The search at the top right still finds every node.")}</p>
      )}
    </div>
  );
}
