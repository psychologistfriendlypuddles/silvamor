import { defineConfig } from 'vite'

// Builds the relay guard into one self-contained file: `node guard/dist/server.mjs`.
export default defineConfig({
  publicDir: false,
  build: {
    ssr: 'guard/src/server.ts',
    outDir: 'guard/dist',
    emptyOutDir: true,
    target: 'node22',
    rolldownOptions: { output: { entryFileNames: 'server.mjs' } },
  },
  // Bundle dependencies too, so a server only needs Node.
  ssr: { noExternal: true, target: 'node' },
})
