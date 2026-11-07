/** PDF保存API（保存先フォルダの設定と、PDFの書き込み）。
 * 開発サーバー（vite.config.js）と本番配信サーバー（server.js）の両方から使う。
 * 書き込みはサーバーを起動したWindowsユーザーの権限で行う（ネットワークフォルダはその権限が必要） */
import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { pdfFileName } from './src/pdf-report.js'

const MAX_PDF_BYTES = 30 * 1024 * 1024
const MAX_SETTINGS_BYTES = 64 * 1024

export function readPdfSettings(settingsFile) {
  try {
    const j = JSON.parse(fs.readFileSync(settingsFile, 'utf8'))
    return { folder: typeof j.folder === 'string' ? j.folder : '' }
  } catch {
    return { folder: '' }
  }
}

// ネットワークフォルダが応答しないとき、待ち続けずに諦めるまでの時間
const FOLDER_TIMEOUT_MS = 15000

/** promise が ms 以内に終わらなければ message のエラーにする */
export function withTimeout(promise, ms, message) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/** 「C:\…」または「\\サーバー名\共有名…」の完全な場所か */
export function isAbsoluteFolderPath(f) {
  return /^[A-Za-z]:[\\/]/.test(f) || /^\\\\[^\\]+\\[^\\]+/.test(f)
}

/** 保存先として使えるかを確かめる。問題があれば理由（日本語）、なければ null。
 * ネットワークフォルダの待ち時間で他の端末への配信を止めないよう、非同期で行う */
export async function validatePdfFolder(folder) {
  const f = typeof folder === 'string' ? folder.trim() : ''
  if (!f) return '保存先フォルダを入力してください'
  if (!isAbsoluteFolderPath(f)) {
    return '保存先は「C:\\…」や「\\\\サーバー名\\共有名\\…」のような完全な場所で指定してください'
  }
  let st
  try {
    st = await withTimeout(fsp.stat(f), FOLDER_TIMEOUT_MS, 'timeout')
  } catch (e) {
    return e.message === 'timeout' ? `保存先に接続できません: ${f}` : `フォルダが見つかりません: ${f}`
  }
  if (!st.isDirectory()) return `フォルダではありません: ${f}`
  const probe = path.join(f, `.3dviewer-write-test-${crypto.randomBytes(4).toString('hex')}`)
  try {
    await withTimeout((async () => {
      await fsp.writeFile(probe, 'test')
      await fsp.unlink(probe)
    })(), FOLDER_TIMEOUT_MS, '保存先に接続できません')
  } catch (e) {
    return `このフォルダに書き込めません: ${e.code ?? e.message}`
  }
  return null
}

/** 上書きしない名前で保存し、保存したファイル名を返す。
 * 書き込みに失敗したら作りかけのファイルを消してからエラーにする */
export async function savePdfFile(folder, modelName, bytes, now = new Date()) {
  const base = pdfFileName(modelName, now).replace(/\.pdf$/, '')
  for (let i = 1; i < 1000; i++) {
    const name = i === 1 ? `${base}.pdf` : `${base}_${i}.pdf`
    const file = path.join(folder, name)
    let fh
    try {
      fh = await fsp.open(file, 'wx') // 既にあれば EEXIST（上書きしない）
    } catch (e) {
      if (e.code === 'EEXIST') continue
      throw e
    }
    try {
      await fh.writeFile(bytes)
      await fh.close()
    } catch (e) {
      await fh.close().catch(() => {})
      await fsp.unlink(file).catch(() => {})
      throw e
    }
    return name
  }
  throw new Error('同じ名前のファイルが多すぎます')
}

function sendJson(res, status, obj) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(obj))
}

/** 本文をBufferで集める。limitを超えたら tooLarge=true（以後は読み捨てる） */
function readBody(req, limit, done) {
  const chunks = []
  let size = 0
  let tooLarge = false
  req.on('data', (chunk) => {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += b.length
    if (size > limit) { tooLarge = true; return }
    chunks.push(b)
  })
  req.on('end', () => done(tooLarge ? null : Buffer.concat(chunks), tooLarge))
}

/** GET/PUT /api/pdf-settings */
export function handlePdfSettings(settingsFile, req, res) {
  if (req.method === 'GET') {
    sendJson(res, 200, readPdfSettings(settingsFile))
    return
  }
  if (req.method !== 'PUT') {
    sendJson(res, 405, { error: 'method not allowed' })
    return
  }
  readBody(req, MAX_SETTINGS_BYTES, (body, tooLarge) => {
    let folder
    try {
      if (tooLarge) throw new Error('too large')
      folder = JSON.parse(body.toString('utf8')).folder
    } catch {
      sendJson(res, 400, { error: '設定の形式が正しくありません' })
      return
    }
    validatePdfFolder(folder).then(async (err) => {
      if (err) {
        sendJson(res, 400, { error: err })
        return
      }
      const settings = { folder: folder.trim() }
      try {
        await fsp.writeFile(settingsFile, JSON.stringify(settings, null, 2), 'utf8')
      } catch (e) {
        sendJson(res, 500, { error: `設定を保存できませんでした: ${e.code ?? e.message}` })
        return
      }
      sendJson(res, 200, settings)
    })
  })
}

/** POST /api/pdf?model=<名前>（本文はPDF） */
export function handlePdfSave(settingsFile, req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method not allowed' })
    return
  }
  const model = new URL(req.url ?? '/', 'http://localhost').searchParams.get('model') ?? ''
  readBody(req, MAX_PDF_BYTES, (body, tooLarge) => {
    const { folder } = readPdfSettings(settingsFile)
    if (!folder) {
      sendJson(res, 409, { error: '保存先フォルダが設定されていません（編集モードの表示設定で設定してください）' })
      return
    }
    if (tooLarge || !body.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
      sendJson(res, 400, { error: 'PDFのデータが正しくありません' })
      return
    }
    withTimeout(savePdfFile(folder, model, body), FOLDER_TIMEOUT_MS, '保存先に接続できません').then(
      (fileName) => sendJson(res, 200, { fileName }),
      (e) => sendJson(res, 500, { error: `保存できませんでした: ${e.code ?? e.message}（${folder}）` }),
    )
  })
}
