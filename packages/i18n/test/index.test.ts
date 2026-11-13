import { afterEach, describe, expect, it } from "vitest";
import { byLocale, getLocale, intlLocale, msg, pickLocale, registerCatalog, setLocale, setLocaleResolver, t, tFor, tn, toLocale, tx, withLocale } from "../src/index";

registerCatalog("de", {
  Save: "Speichern",
  "Moved to {folder}": "Nach {folder} verschoben",
  "{n} entry": "{n} Eintrag",
  "{n} entries": "{n} Einträge",
  "verb::Open": "Öffnen",
  "state::Open": "Offen",
});

afterEach(() => {
  setLocale("en");
  setLocaleResolver(null);
});

describe("i18n", () => {
  it("returns the English source by default and the translation in German", () => {
    expect(t("Save")).toBe("Save");
    setLocale("de");
    expect(t("Save")).toBe("Speichern");
    expect(t("Not in the catalog")).toBe("Not in the catalog");
  });

  it("fills placeholders and keeps unknown ones", () => {
    setLocale("de");
    expect(t("Moved to {folder}", { folder: "Inbox" })).toBe("Nach Inbox verschoben");
    expect(t("Moved to {folder}")).toBe("Nach {folder} verschoben");
  });

  it("picks the plural form by count", () => {
    expect(tn(1, "{n} entry", "{n} entries")).toBe("1 entry");
    expect(tn(0, "{n} entry", "{n} entries")).toBe("0 entries");
    setLocale("de");
    expect(tn(1, "{n} entry", "{n} entries")).toBe("1 Eintrag");
    expect(tn(5, "{n} entry", "{n} entries")).toBe("5 Einträge");
  });

  it("separates meanings by context", () => {
    expect(tx("verb", "Open")).toBe("Open");
    setLocale("de");
    expect(tx("verb", "Open")).toBe("Öffnen");
    expect(tx("state", "Open")).toBe("Offen");
  });

  it("a resolver wins over the process-wide language", () => {
    setLocale("en");
    setLocaleResolver(() => "de");
    expect(getLocale()).toBe("de");
    expect(t("Save")).toBe("Speichern");
    setLocaleResolver(() => undefined);
    expect(t("Save")).toBe("Save");
  });

  it("maps language tags and preference lists", () => {
    expect(toLocale("de-AT")).toBe("de");
    expect(toLocale("fr")).toBe("en");
    expect(toLocale(null)).toBe("en");
    expect(pickLocale(["fr-FR", "de-DE", "en"])).toBe("de");
    expect(pickLocale(["fr", "en-GB", "de"])).toBe("en");
    expect(pickLocale([])).toBe("en");
    expect(intlLocale("de")).toBe("de-DE");
    expect(intlLocale()).toBe("en-US");
  });

  it("tFor, msg and withLocale", () => {
    expect(tFor("de", "Save")).toBe("Speichern");
    expect(msg("Save")).toBe("Save");
    expect(byLocale({ en: 1, de: 2 })).toBe(1);
    expect(byLocale({ en: 1, de: 2 }, "de")).toBe(2);
    expect(byLocale({ en: 1 }, "de")).toBe(1);
    expect(withLocale("de", () => t("Save"))).toBe("Speichern");
    expect(getLocale()).toBe("en");
  });
});

describe("product name", () => {
  it("is Kortex in tests, whatever product.json says, and leaves texts untouched", async () => {
    const { PRODUCT_NAME, brand, productName } = await import("../src/index");
    expect(PRODUCT_NAME).toBe("Kortex");
    expect(brand("Open Kortex")).toBe("Open Kortex");
    expect(productName("OpenKortex", { VITEST: "true" })).toBe("Kortex");
    expect(productName("OpenKortex", {})).toBe("OpenKortex");
    expect(productName(" ", undefined)).toBe("Kortex");
  });

  it("swaps only the whole word, never technical ids", async () => {
    const { brandWith } = await import("../src/index");
    expect(brandWith("OpenKortex", "Kortex · 5 reminders due")).toBe("OpenKortex · 5 reminders due");
    expect(brandWith("OpenKortex", "noch kein Kortex-Vault")).toBe("noch kein OpenKortex-Vault");
    expect(brandWith("OpenKortex", "~/KortexVault, X-Kortex-Locale, kortex://")).toBe("~/KortexVault, X-Kortex-Locale, kortex://");
  });
});

describe("features", () => {
  it("reads the switch from product.json (on privately, off in the export); tests can turn it", async () => {
    const { FEATURES, feature } = await import("../src/index");
    const product = (await import("../product.json")).default as { features?: { griply?: boolean } };
    expect(feature("griply")).toBe(product.features?.griply !== false);
    const initial = FEATURES.griply;
    FEATURES.griply = !initial;
    expect(feature("griply")).toBe(!initial);
    FEATURES.griply = initial;
  });
});
