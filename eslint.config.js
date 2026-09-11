// ESLint 9+/10 flat config. `--ext` no longer exists in the CLI; the `files`
// globs below take its place, which is why the lint script is a bare `eslint .`.
const tsParser = require('@typescript-eslint/parser');

/** Nothing under src/engine may reach for the app runtime. See CLAUDE.md. */
const ENGINE_FORBIDDEN = [
  {
    group: ['react', 'react/*', 'react-dom', 'react-dom/*'],
    message: 'src/engine is pure TypeScript. No React — the Node server imports this code.',
  },
  {
    group: ['react-native', 'react-native/*', 'react-native-*'],
    message: 'src/engine is pure TypeScript. No React Native — it must run under plain Node.',
  },
  {
    group: ['expo', 'expo-*', '@expo/*', '@expo-google-fonts/*'],
    message: 'src/engine is pure TypeScript. No expo-* modules.',
  },
  {
    group: ['@/*', '@ui/*', '@board/*'],
    message: 'src/engine may not import from other src/ directories. Keep it self-contained.',
  },
];

module.exports = [
  {
    ignores: [
      'node_modules/**',
      '.expo/**',
      'dist/**',
      'android/**',
      'ios/**',
      'server/node_modules/**',
      'expo-env.d.ts',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    linterOptions: { reportUnusedDisableDirectives: true },
    rules: {
      'no-restricted-imports': 'off',
      eqeqeq: ['warn', 'smart'],
      'no-var': 'error',
      'prefer-const': 'warn',
    },
  },
  // ---- Engine purity: files sitting directly in src/engine ----
  {
    files: ['src/engine/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [...ENGINE_FORBIDDEN, { group: ['../*'], message: 'src/engine may not import from outside src/engine.' }] },
      ],
    },
  },
  // ---- Engine purity: one level deeper (src/engine/__tests__ etc.) ----
  {
    files: ['src/engine/*/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [...ENGINE_FORBIDDEN, { group: ['../../*'], message: 'src/engine may not import from outside src/engine.' }] },
      ],
    },
  },
];
