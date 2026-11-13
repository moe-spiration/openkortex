// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContextMenu, type ContextMenuProps } from "./ContextMenu";
import { menuFor } from "./model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const mount = (props: Partial<ContextMenuProps> = {}) => {
  const onAction = vi.fn();
  const onClose = vi.fn();
  act(() =>
    root.render(
      <ContextMenu
        at={{ x: 40, y: 40 }}
        sections={menuFor({ kind: "item" })}
        folders={["10_Notes", "30_Clippings/Artikel"]}
        tags={["#ai", "#food"]}
        activeTags={["#ai"]}
        onAction={onAction}
        onClose={onClose}
        {...props}
      />,
    ),
  );
  const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
  return { menu, onAction, onClose };
};

const key = (el: Element, k: string, init: KeyboardEventInit = {}) => act(() => void el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init })));
const labels = () => [...document.querySelectorAll('[role^="menuitem"]')].map((e) => (e.querySelector("span") ?? e).textContent?.trim());

describe("ContextMenu", () => {
  it("renders nothing while closed", () => {
    mount({ at: null });
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("lists the model's actions and focuses the menu", () => {
    const { menu } = mount();
    expect(labels()).toEqual(expect.arrayContaining(["Öffnen", "In Split öffnen", "Link kopieren", "Archivieren", "Löschen"]));
    expect(document.activeElement).toBe(menu);
  });

  it("runs the highlighted action on Enter and closes", () => {
    const { menu, onAction, onClose } = mount();
    key(menu, "Enter");
    expect(onAction).toHaveBeenCalledWith("open");
    expect(onClose).toHaveBeenCalled();
  });

  it("moves with the arrow keys and wraps", () => {
    const { menu, onAction } = mount();
    key(menu, "ArrowDown");
    key(menu, "Enter");
    expect(onAction).toHaveBeenLastCalledWith("open-split");
    key(menu, "ArrowUp");
    key(menu, "ArrowUp");
    key(menu, "Enter");
    expect(onAction).toHaveBeenLastCalledWith("delete");
  });

  it("closes on Escape", () => {
    const { menu, onClose } = mount();
    key(menu, "Escape");
    expect(onClose).toHaveBeenCalled();
  });

  it("goes into the folder list for Verschieben and back with Escape", () => {
    const { menu, onAction, onClose } = mount();
    const move = [...document.querySelectorAll('[role="menuitem"]')].findIndex((e) => e.textContent?.includes("Verschieben"));
    for (let i = 0; i < move; i += 1) key(menu, "ArrowDown");
    key(menu, "ArrowRight");
    expect(labels()).toEqual(["Verschieben nach", "10_Notes", "30_Clippings/Artikel"]);
    key(menu, "Escape");
    expect(onClose).not.toHaveBeenCalled();
    expect(labels()).toContain("Öffnen");
    key(menu, "ArrowRight");
    key(menu, "ArrowDown");
    key(menu, "Enter");
    expect(onAction).toHaveBeenCalledWith("move", "30_Clippings/Artikel");
  });

  it("marks active tags and toggles one", () => {
    const { menu, onAction } = mount({ initialLevel: "tags" });
    const items = [...document.querySelectorAll('[role="menuitemcheckbox"]')];
    expect(items.map((e) => [e.textContent?.trim(), e.getAttribute("aria-checked")])).toEqual([
      ["#ai", "true"],
      ["#food", "false"],
    ]);
    key(menu, "Enter");
    expect(onAction).toHaveBeenCalledWith("tags", "#ai");
  });

  it("adds a new tag from the input row", () => {
    const { menu, onAction } = mount({ initialLevel: "tags" });
    key(menu, "End");
    const input = document.querySelector<HTMLInputElement>("input")!;
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(input, "neu");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    key(input, "Enter");
    expect(onAction).toHaveBeenCalledWith("tags", "#neu");
  });

  it("closes on a click outside", () => {
    const { onClose } = mount();
    act(() => void document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(onClose).toHaveBeenCalled();
  });
});
