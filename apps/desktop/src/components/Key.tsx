/** One flat key (Ruhe: no keycap edge, Geist, t3 on lum-3; ruhe-desktop.css `.kxd-k`). */
export function Key({ k }: { k: string }) {
  return <kbd className="kxd-k">{k}</kbd>;
}

/** A shortcut as flat keys, e.g. ["Ctrl", "Shift", "H"] or "Ctrl+Shift+H". */
export function Keys({ keys }: { keys: readonly string[] | string }) {
  const list = typeof keys === "string" ? keys.split("+").filter(Boolean) : keys;
  return (
    <span className="kxd-keys">
      {list.map((k) => (
        <Key key={k} k={k} />
      ))}
    </span>
  );
}
