// NOTE: @typescript-eslint peer range currently declares support up to TypeScript 5.x.
// TypeScript 6 support is not yet declared in the peer range — this may produce a
// peer-dependency warning. It is a cosmetic warning only; functionality is unaffected.
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier";

export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "data/**",
      "demo/**",
      "**/*.cjs",
      "**/*.js",
    ],
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
      "react-hooks": reactHooks,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-empty-object-type": "warn",
      "@typescript-eslint/no-require-imports": "warn",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // Downgrade to warn: data-fetching (setLoading at effect start) and
      // error-reset (setError(false) on prop change) are valid React patterns.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  prettier,
];
