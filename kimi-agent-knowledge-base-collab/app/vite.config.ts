import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [inspectAttr(), react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const nodeModulesIndex = id.lastIndexOf('node_modules/');
          if (nodeModulesIndex === -1) {
            return;
          }

          const packagePath = id.slice(nodeModulesIndex + 'node_modules/'.length);
          const segments = packagePath.split('/');
          if (segments[0] === '.pnpm' && segments.length > 2) {
            const nestedIndex = packagePath.indexOf('node_modules/');
            if (nestedIndex !== -1) {
              const nestedPath = packagePath.slice(nestedIndex + 'node_modules/'.length);
              const nestedSegments = nestedPath.split('/');
              const scopedName = nestedSegments[0]?.startsWith('@')
                ? `${nestedSegments[0]}/${nestedSegments[1] || ''}`
                : nestedSegments[0];
              if (scopedName) {
                return `pkg-${scopedName.replace('@', '').replace('/', '-')}`;
              }
            }
          }

          const packageName = segments[0]?.startsWith('@')
            ? `${segments[0]}/${segments[1] || ''}`
            : segments[0];
          if (!packageName) {
            return;
          }

          return `pkg-${packageName.replace('@', '').replace('/', '-')}`;
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
