import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

/**
 * One flat config for the whole workspace: the app and both scene packages are
 * the same codebase and should be held to the same rules.
 */
const config = [
  {
    ignores: [
      '**/.next/**',
      '**/node_modules/**',
      '**/dist/**',
      '**/next-env.d.ts',
      '.checkpoint/**',
      'assets/**',
      'tests/output/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // R3F puts three.js objects into JSX; the a11y and next rules that assume
      // DOM elements do not apply to <mesh>, <group> and friends.
      'react/no-unknown-property': 'off',
    },
  },
  {
    // The scene layer is deliberately imperative: `useFrame` mutates three.js
    // objects in place sixty times a second, which is exactly how React Three
    // Fiber is meant to be driven and exactly what keeps React out of the
    // render loop. The React Compiler rules assume a pure-render component
    // model and flag every one of those mutations, so they are switched off
    // here — and only here. Component-level correctness in the app UI still
    // gets the full rule set.
    files: ['packages/scene/src/**/*.{ts,tsx}'],
    rules: {
      'react-hooks/immutability': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
    },
  },
];

export default config;
