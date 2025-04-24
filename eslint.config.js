import js from "@eslint/js";
import globals from "globals";
import pluginReact from "eslint-plugin-react";
import reactRecommended from "eslint-plugin-react/configs/recommended.js";
import reactJSXRuntime from "eslint-plugin-react/configs/jsx-runtime.js";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import css from "@eslint/css";
import { defineConfig } from "eslint/config";


export default defineConfig([
  { files: ["**/*.{js,mjs,cjs,jsx}"], plugins: { js }, extends: ["js/recommended"] },
  { files: ["**/*.{js,mjs,cjs,jsx}"], languageOptions: { globals: globals.browser } },
  pluginReact.configs.flat.recommended,
  { files: ["**/*.css"], plugins: { css }, language: "css/css", extends: ["css/recommended"] },
  reactRecommended,
  reactJSXRuntime,
  {
    plugins: {
      "react-hooks": reactHooksPlugin,
    },
    rules: reactHooksPlugin.configs.recommended.rules,
  },
]);