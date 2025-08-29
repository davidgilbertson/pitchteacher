import { defineConfig } from 'vite';

// No React plugin to keep deps minimal; use esbuild JSX transform
export default defineConfig({
  esbuild: {
    jsx: 'automatic'
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
