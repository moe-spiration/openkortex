// The suite asserts the German texts (OAuth pages, messages): it runs in German, which also proves
// that German behaviour is unchanged. English cases switch with `withLocale("en", …)`.
import { setLocale } from "@kortex/i18n";
import "../src/i18n";

setLocale("de");
