import { defineConfig } from 'vite'

// Builds the push service into one self-contained file: `node push/dist/server.mjs`.
export default defineConfig({
  publicDir: false,
  build: {
    ssr: 'push/src/server.ts',
    outDir: 'push/dist',
    emptyOutDir: true,
    target: 'node22',
    rolldownOptions: { output: { entryFileNames: 'server.mjs' } },
  },
  // Bundle dependencies too, so a server only needs Node.
  ssr: { noExternal: true, target: 'node' },
})
