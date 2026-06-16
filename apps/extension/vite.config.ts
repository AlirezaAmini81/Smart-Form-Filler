import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

const root = path.resolve(__dirname)

export default defineConfig({
  root,
  plugins: [react()],
  build: {
    outDir: path.resolve(root, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: path.resolve(root, 'index.html'),
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
