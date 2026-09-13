import { baseConfig } from './base.js';

/** ESLint flat config for NestJS-style decorator-based services. */
export const nestjsConfig = [
  ...baseConfig,
  {
    rules: {
      '@typescript-eslint/no-extraneous-class': 'off',
      '@typescript-eslint/no-useless-constructor': 'off',
      '@typescript-eslint/parameter-properties': 'off',
      // NestJS resolves constructor-injected dependencies from reflected
      // design:paramtypes metadata, which requires the injected class to
      // remain a value import even though it appears only in a type
      // position syntactically. This rule can't tell that usage apart from
      // an actually type-only one and will "fix" away a working DI
      // dependency, so it stays off for NestJS code.
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
];

export default nestjsConfig;
