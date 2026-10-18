import js from "@eslint/js";
import stylistic from "@stylistic/eslint-plugin";
import globals from "globals";
import tseslint from "typescript-eslint";

const tsFiles = ["**/*.ts", "**/*.mts", "**/*.cts"];

const nodeLanguageOptions = {
  ecmaVersion: "latest",
  sourceType: "module",
  globals: {
    ...globals.node,
  },
};

export default tseslint.config(
  { ignores: ["dist/**", "coverage/**", "node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked.map((config) => ({ ...config, files: tsFiles })),
  stylistic.configs.customize({
    arrowParens: true,
    braceStyle: "1tbs",
    indent: 2,
    quotes: "double",
    semi: true,
  }),
  {
    languageOptions: nodeLanguageOptions,
    rules: {
      eqeqeq: ["error", "always"],
    },
  },
  {
    files: tsFiles,
    languageOptions: {
      ...nodeLanguageOptions,
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector: "AssignmentExpression[right.callee.object.name='JSON'][right.callee.property.name='parse'], AssignmentExpression[right.expression.callee.object.name='JSON'][right.expression.callee.property.name='parse']",
          message: "Unsafe assignment of JSON.parse. Use parseUnknownJson so pnpm lint rejects the any result.",
        },
        {
          selector: "VariableDeclarator[init.callee.object.name='JSON'][init.callee.property.name='parse'], VariableDeclarator[init.expression.callee.object.name='JSON'][init.expression.callee.property.name='parse']",
          message: "Unsafe assignment of JSON.parse. Use parseUnknownJson so pnpm lint rejects the any result.",
        },
        {
          selector: "ReturnStatement[argument.callee.object.name='JSON'][argument.callee.property.name='parse'], ReturnStatement[argument.expression.callee.object.name='JSON'][argument.expression.callee.property.name='parse']",
          message: "Unsafe assignment of JSON.parse. Use parseUnknownJson so pnpm lint rejects the any result.",
        },
        {
          selector: "CallExpression[arguments.0.callee.object.name='JSON'][arguments.0.callee.property.name='parse'], CallExpression[arguments.0.expression.callee.object.name='JSON'][arguments.0.expression.callee.property.name='parse']",
          message: "Unsafe JSON.parse argument. Use parseUnknownJson so pnpm lint rejects the any result.",
        },
      ],
    },
  },
);
