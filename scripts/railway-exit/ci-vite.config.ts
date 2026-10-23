import base from '../../vite.config';
import { defineConfig, mergeConfig } from 'vite';
export default defineConfig(context => mergeConfig(base(context), { envDir: false }));
