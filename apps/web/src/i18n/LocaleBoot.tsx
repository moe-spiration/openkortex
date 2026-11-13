"use client";

import type { ReactNode } from "react";
import { setLocale, type Locale } from "@kortex/i18n";
import "./index";

/**
 * Sets the language before anything below renders: on the server for the HTML of this request, in
 * the browser for the whole tab. `locale` is what the root layout read from the request.
 */
export function LocaleBoot({ locale, children }: { locale: Locale; children: ReactNode }) {
  setLocale(locale);
  return children;
}
