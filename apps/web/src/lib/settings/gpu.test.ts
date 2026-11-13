// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_APPEARANCE, appearanceAttributes, applyAppearance } from "./appearance";
import { GPU_KEY, classifyRenderer, readGpuProbe } from "./gpu";

beforeEach(() => window.localStorage.clear());

describe("software rendering → solid glass", () => {
  it("classifies WebGL renderers: SwiftShader, llvmpipe, WARP and no WebGL are software", () => {
    expect(classifyRenderer("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)")).toBe("soft");
    expect(classifyRenderer("llvmpipe (LLVM 15.0.7, 256 bits)")).toBe("soft");
    expect(classifyRenderer("ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)")).toBe("soft");
    expect(classifyRenderer(null)).toBe("soft");
    expect(classifyRenderer("ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)")).toBe("hw");
    expect(classifyRenderer("ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)")).toBe("hw");
  });

  it("software rendering makes glass solid without touching the backdrop or the user's setting", () => {
    expect(appearanceAttributes({ ...DEFAULT_APPEARANCE, backdrop: "pack" }, true)).toEqual({ backdrop: "pack", density: "kompakt", glass: "solid" });
    expect(appearanceAttributes(DEFAULT_APPEARANCE, false).glass).toBe("on");
    const el = document.createElement("html");
    window.localStorage.setItem(GPU_KEY, "soft");
    expect(readGpuProbe()).toBe("soft");
    applyAppearance(DEFAULT_APPEARANCE, el);
    expect(el.dataset.glass).toBe("solid");
    window.localStorage.setItem(GPU_KEY, "junk");
    expect(readGpuProbe()).toBeNull();
    applyAppearance(DEFAULT_APPEARANCE, el);
    expect(el.dataset.glass).toBe("on");
  });
});
