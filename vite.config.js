import { defineConfig } from 'vite';

// Capture build time at config evaluation (UTC ISO string)
const BUILD_TIME_ISO = new Date().toISOString();

// No React plugin to keep deps minimal; use esbuild JSX transform
export default defineConfig({
  esbuild: {
    jsx: 'automatic'
  },
  define: {
    __BUILD_TIME__: JSON.stringify(BUILD_TIME_ISO),
  },
  server: {
    port: 8080,
    strictPort: true,
    host: true // listen on all interfaces (0.0.0.0)
  },
  preview: {
    port: 8080,
    strictPort: true,
    host: true
  }
});
