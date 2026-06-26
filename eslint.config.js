import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "ios/**",
      "supabase/.temp/**",
      "supabase/functions/**",
    ],
  },
  {
    files: [
      "src/**/*.{js,jsx}",
      "api/**/*.js",
      "scripts/**/*.js",
      "scripts/**/*.mjs",
    ],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      "no-constant-binary-expression": "error",
      "no-redeclare": "error",
      "no-undef": "error",
      "no-unreachable": "error",
      "react-hooks/rules-of-hooks": "error",
    },
  },
];
