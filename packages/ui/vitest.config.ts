import { defineConfig } from 'vitest/config';

// The datatype-registry tests touch only the pure registry/codecs modules (no JSX runtime, no
// DOM), so a minimal node config suffices — no solid plugin needed.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
