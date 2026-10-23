import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  // Create-Where-You-Are guardrail: a field that refers to a customer, supplier, contact, company, account or item is a searchable picker
  // with create (RecordPicker, SalesSearchPicker, ProcurementSearchPicker, or ComboBox with onCreate), never a <Select> of a preloaded list.
  {
    files: ["src/**/*.tsx"],
    rules: {
      "no-restricted-syntax": ["error", {
        selector: "JSXOpeningElement[name.name='Select'] > JSXAttribute[name.name='options'] MemberExpression[property.name=/^(customers|suppliers|parties|contacts|items|products)$/]",
        message: "A customer, supplier, contact, company, account or item is chosen with a searchable picker that can create (RecordPicker), not a <Select> of a preloaded list.",
      }],
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "next-env.d.ts",
    "playwright-report/**",
    "test-results/**",
    "storybook-static/**",
  ]),
]);
