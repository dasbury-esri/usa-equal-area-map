import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react-x";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import css from "@eslint/css";
import { defineConfig } from "eslint/config";


export default defineConfig([
  { ignores: ["dist/**", "node_modules/**"] },
  { files: ["**/*.{js,mjs,cjs,jsx}"], extends: [js.configs.recommended] },
  { files: ["**/*.{js,mjs,cjs,jsx}"], languageOptions: { globals: globals.browser } },
  { files: ["tests/**/*.mjs", "*.config.js"], languageOptions: { globals: globals.node } },
  { files: ["**/*.css"], plugins: { css }, language: "css/css", extends: ["css/recommended"] },
  {
    files: ["**/*.jsx"],
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: {
      "react-x": react,
      "react-hooks": reactHooksPlugin,
    },
    rules: { ...react.configs.recommended.rules, ...reactHooksPlugin.configs.recommended.rules },
  },
]);