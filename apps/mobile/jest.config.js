// Jest config for mobile logic + component tests (jest-expo preset).
// The SQLite persistence layer is tested separately under `npm run test:db`
// (node --test + node:sqlite), mirroring how apps/api splits its suites.
const preset = require('jest-expo/jest-preset');

module.exports = {
  ...preset,
  // Watchman is broken on this machine (Homebrew libfmt mismatch); fall back to node crawling.
  watchman: false,
  // The template imports a CSS file for web fonts; Jest cannot parse it. This must precede
  // the preset's `^@/(.*)$` mapping so `@/global.css` is stubbed, not resolved.
  moduleNameMapper: {
    '\\.(css)$': '<rootDir>/jest/style-mock.js',
    ...preset.moduleNameMapper,
  },
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  testPathIgnorePatterns: ['/node_modules/', '/test-db/'],
};
