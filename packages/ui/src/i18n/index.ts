// Registers the German catalog of @kortex/ui (the English source text is the key, see @kortex/i18n).
// Imported for its side effect by every entry file of the package (index.ts, editor/index.ts,
// menu/core.ts); the package only reads the language, the host app sets it.
import { registerCatalog, type Catalog } from "@kortex/i18n";
import ui from "./de/ui.json";

registerCatalog("de", ui as Catalog);
