/** LAN公開用の本番配信サーバー（依存パッケージなし）。
 *
 * `npm run build` で生成した dist/ を配信し、開発サーバーと同じ
 * /api/models・/models/* のモデル一覧・配信・注釈保存APIと、
 * /api/pdf-settings・/api/pdf のPDF保存APIを提供する。
 * 開発サーバー（vite）の非バンドル配信より読み込みが速く、
 * GLBはETag/304対応で2回目以降の再ダウンロードが不要になる。
 *
 * 使い方: node server.js [ポート番号(既定4000)]
 */
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { handleModelsList, handleModelFile } from './models-api.js'
import { handlePdfSave, handlePdfSettings } from './pdf-api.js'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const DIST_DIR = path.join(ROOT, 'dist')
const MODELS_DIR = path.join(ROOT, 'models')
const PDF_SETTINGS = path.join(ROOT, 'pdf-settings.json')
const PORT = Number(process.argv[2]) || 4000

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm',
}

function serveStatic(req, res, urlPath) {
  // パス正規化で dist/ の外に出ないようにする
  const rel = path.normalize(urlPath === '/' ? '/index.html' : urlPath).replace(/^([/\\.])+/, '')
  const file = path.join(DIST_DIR, rel)
  if (!file.startsWith(DIST_DIR) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.statusCode = 404
    res.end('not found')
    return
  }
  const ext = path.extname(file).toLowerCase()
  res.setHeader('Content-Type', CONTENT_TYPES[ext] ?? 'application/octet-stream')
  // viteのビルド成果物はファイル名にハッシュが付くため長期キャッシュできる。
  // index.htmlだけは更新を即反映させたいのでキャッシュしない
  res.setHeader('Cache-Control',
    rel.startsWith('assets') ? 'public, max-age=31536000, immutable' : 'no-cache')
  res.setHeader('Content-Length', fs.statSync(file).size)
  fs.createReadStream(file).pipe(res)
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0])
  if (urlPath === '/api/models') {
    handleModelsList(MODELS_DIR, req, res)
  } else if (urlPath === '/api/pdf-settings') {
    handlePdfSettings(PDF_SETTINGS, req, res)
  } else if (urlPath === '/api/pdf') {
    handlePdfSave(PDF_SETTINGS, req, res)
  } else if (urlPath.startsWith('/models/')) {
    handleModelFile(MODELS_DIR, urlPath.slice('/models/'.length), req, res)
  } else {
    serveStatic(req, res, urlPath)
  }
})

if (!fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
  console.error('dist/index.html が見つかりません。先に npm run build を実行してください。')
  process.exit(1)
}

server.listen(PORT, '0.0.0.0', () => {
  console.log('3Dモデルビューア（LAN公開モード）を起動しました')
  console.log(`  Local:   http://localhost:${PORT}/`)
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        console.log(`  Network: http://${iface.address}:${PORT}/  ← このアドレスを皆に知らせてください`)
      }
    }
  }
})
