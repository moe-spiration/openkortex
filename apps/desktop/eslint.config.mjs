import globals from "globals";
import base from "../../eslint.config.mjs";

export default [
  ...base,
  { ignores: ["src-tauri/**", "dist/**"] },
  {
    files: ["src/**/*.{ts,tsx}", "test/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser } },
  },
];
