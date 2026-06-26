import { defineConfig } from 'vitest/config';

// Standalone config (does not extend vite.config.ts) so unit tests don't pull in
// the Converse.js headless bundle or the firebase/messaging external. Unit tests
// target pure logic modules and import them by relative path.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['e2e/**', 'node_modules/**'],
    environment: 'node',
  },
});
