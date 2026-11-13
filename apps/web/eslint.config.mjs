import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";
import base from "../../eslint.config.mjs";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  ...base,
  ...compat.extends("next/core-web-vitals"),
  { settings: { next: { rootDir: import.meta.dirname } } },
];

export default config;
