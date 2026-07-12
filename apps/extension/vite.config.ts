import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

const root = path.resolve(__dirname)

function enforceClassicContentScript() {
  return {
    name: 'enforce-classic-content-script',
    generateBundle(_options: unknown, bundle: Record<string, unknown>) {
      const contentChunk = Object.values(bundle).find((output) => {
        if (!output || typeof output !== 'object') return false
        const chunk = output as { type?: string; fileName?: string }
        return chunk.type === 'chunk' && chunk.fileName === 'assets/content.js'
      }) as { imports?: string[]; dynamicImports?: string[] } | undefined

      if (contentChunk?.imports?.length || contentChunk?.dynamicImports?.length) {
        throw new Error(
          'MV3 manifest content scripts must be self-contained classic scripts; content.js contains module imports.'
        )
      }
    }
  }
}

export default defineConfig({
  root,
  plugins: [react(), tailwindcss(), enforceClassicContentScript()],
  build: {
    outDir: path.resolve(root, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: path.resolve(root, 'index.html'),
        settings: path.resolve(root, 'settings.html'),
        setup: path.resolve(root, 'setup.html'),
        content: path.resolve(root, 'src/content/index.ts'),
        background: path.resolve(root, 'src/background/index.ts')
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]'
      }
    }
  },
  server: {
    port: 5173
  }
})
