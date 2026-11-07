import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { handleModelsList, handleModelFile } from './models-api.js'
import { handlePdfSave, handlePdfSettings } from './pdf-api.js'

const MODELS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'models')
// 確認用に別の設定ファイルを使えるよう、環境変数で差し替え可能にする
const PDF_SETTINGS = process.env.VIEWER_PDF_SETTINGS
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'pdf-settings.json')

/** viewer/models/ のGLBを一覧・配信する開発サーバー用プラグイン（LAN共有向け） */
function modelsDirPlugin() {
  return {
    name: 'models-dir',
    configureServer(server) {
      server.middlewares.use('/api/pdf-settings', (req, res) => {
        handlePdfSettings(PDF_SETTINGS, req, res)
      })
      server.middlewares.use('/api/pdf', (req, res) => {
        handlePdfSave(PDF_SETTINGS, req, res)
      })
      server.middlewares.use('/api/models', (req, res) => {
        handleModelsList(MODELS_DIR, req, res)
      })
      server.middlewares.use('/models/', (req, res) => {
        const name = decodeURIComponent((req.url ?? '').split('?')[0].replace(/^\//, ''))
        handleModelFile(MODELS_DIR, name, req, res)
      })
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [modelsDirPlugin()],
  server: {
    port: 4000,
    strictPort: true,
  },
})
