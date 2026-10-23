import base from '../../vitest.config';
import { defineConfig, mergeConfig } from 'vitest/config';
export default mergeConfig(base, defineConfig({ envDir: false, test: { maxWorkers: 2, setupFiles: ['./scripts/railway-exit/ci-no-network.ts'] } }));
