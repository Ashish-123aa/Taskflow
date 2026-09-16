module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  env: {
    node: true,
    es2022: true,
  },
  ignorePatterns: ['dist', 'build', 'node_modules', '*.config.js', '*.config.ts'],
  rules: {
    // Business logic belongs in services/handlers, not controllers or
    // components — this doesn't catch that architecturally, but it does
    // catch the more common smell: silently ignored errors and unused
    // variables that hide the fact logic was never separated out.
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'warn',
    'no-console': 'off',
  },
};
