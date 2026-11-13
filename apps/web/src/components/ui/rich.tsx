import { Fragment, type ReactNode } from "react";

/**
 * Puts React nodes into a translated sentence: the caller passes the translated text, still holding its
 * `{name}` placeholders (so `t` without params), and one node per placeholder name.
 * The sentence stays one catalog entry.
 */
export function rich(text: string, nodes: Record<string, ReactNode>): ReactNode {
  return text.split(/(\{\w+\})/).map((part, i) => {
    const name = /^\{(\w+)\}$/.exec(part)?.[1];
    return <Fragment key={i}>{name !== undefined && name in nodes ? nodes[name] : part}</Fragment>;
  });
}
