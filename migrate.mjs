/** 古い版のフォルダから、モデル・ラベル・設定を、新しい版のフォルダへ写す（データ引き継ぎ.bat から呼ぶ）。
 * 古いフォルダの中身は変えない（読むだけ）。Node.js の標準機能だけで動く（初回セットアップの前でも使えるように）。
 * 書き方・窓の文言は、他のアプリの migrate.py（データ引き継ぎ.bat）とそろえている。 */
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

const APP_TITLE = '3Dモデルビューア'
const PORT = 4000
const HEALTH_PATH = '/api/models'
// 古いフォルダがこのアプリか見分けるもの（全部あること）
const APP_MARKERS = ['viewer/server.js', 'converter']
const MODELS_DIR = 'viewer/models'
const PDF_SETTINGS = 'viewer/pdf-settings.json'
// いつも写すもの（無ければ飛ばす）
const FIXED = [MODELS_DIR, PDF_SETTINGS]
const SAMPLE_DIR = '見本データ'

class MigrateError extends Error {}

/** このPCで 3Dモデルビューアが動いているか（ポートが開いているだけでなく、モデル一覧の JSON が返るか） */
export async function appIsRunning() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}${HEALTH_PATH}`, { signal: AbortSignal.timeout(2000) })
    await r.json()
    return true
  } catch {
    return false
  }
}

/** フォルダごと写す。fs.cpSync は Node.js 24 で、日本語を含む場所のフォルダを写すと
 * 何も言わずに終了してしまう（実際に確かめた）ので使わない */
function copyTree(src, dst) {
  if (!fs.statSync(src).isDirectory()) {
    fs.copyFileSync(src, dst)
    const st = fs.statSync(src)
    fs.utimesSync(dst, st.atime, st.mtime)
    return
  }
  fs.mkdirSync(dst, { recursive: true })
  for (const name of fs.readdirSync(src)) copyTree(path.join(src, name), path.join(dst, name))
}

function countFiles(p) {
  if (!fs.statSync(p).isDirectory()) return 1
  return fs.readdirSync(p, { recursive: true, withFileTypes: true }).filter((d) => d.isFile()).length
}

/** 新しいフォルダで先に使った跡（モデル・ラベル・PDF保存先）があるか */
function hasNewData(dir) {
  if (fs.existsSync(path.join(dir, PDF_SETTINGS))) return true
  const models = path.join(dir, MODELS_DIR)
  return fs.existsSync(models) && fs.readdirSync(models).some((f) => /\.(glb|json)$/i.test(f))
}

function stamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/** 写した内容を、画面に出す行の配列で返す。写せないときは MigrateError（何も写さない） */
export async function migrate(oldDir, newDir, { overwrite = false, isRunning = appIsRunning } = {}) {
  if (!fs.existsSync(oldDir) || !fs.statSync(oldDir).isDirectory()) {
    throw new MigrateError(`古いフォルダが見つかりません: ${oldDir}`)
  }
  if (path.resolve(oldDir).toLowerCase() === path.resolve(newDir).toLowerCase()) {
    throw new MigrateError('古いフォルダに、この新しいフォルダが指定されています。古い版のフォルダを指定してください')
  }
  if (!APP_MARKERS.every((m) => fs.existsSync(path.join(oldDir, m)))) {
    throw new MigrateError(`このアプリのフォルダではないようです（${APP_MARKERS.join('・')} がありません）: ${oldDir}`)
  }
  if (await isRunning()) {
    throw new MigrateError('アプリが動いています。黒い窓を閉じるか Ctrl + C を押して止めてから、もう一度実行してください')
  }
  const used = hasNewData(newDir)
  if (used && !overwrite) {
    throw new MigrateError('新しいフォルダには、すでにモデルや設定があります。新しいフォルダで一度使ったためです')
  }

  const report = []
  // 新しいフォルダの内容を上書きするときは、消さずに見本データへ移しておく
  if (used) {
    const keep = path.join(newDir, SAMPLE_DIR, `上書き前_${stamp()}`)
    for (const rel of FIXED) {
      const src = path.join(newDir, rel)
      if (!fs.existsSync(src)) continue
      const dst = path.join(keep, path.basename(rel))
      fs.mkdirSync(path.dirname(dst), { recursive: true })
      fs.renameSync(src, dst)
    }
    report.push(`新しいフォルダにあったモデルや設定は ${path.relative(newDir, keep)} へ移しました`)
  }

  for (const rel of FIXED) {
    const src = path.join(oldDir, rel)
    if (!fs.existsSync(src)) continue
    const dst = path.join(newDir, rel)
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    copyTree(src, dst)
    const shown = rel.replaceAll('/', '\\')
    report.push(`写しました: ${shown}` + (fs.statSync(src).isDirectory() ? `（ファイル ${countFiles(src)} 個）` : ''))
  }
  // PDF保存先はアプリの外のフォルダなので、写さずに同じ場所を使い続ける
  try {
    const folder = JSON.parse(fs.readFileSync(path.join(oldDir, PDF_SETTINGS), 'utf8')).folder
    if (folder) report.push(`PDF保存先（${folder}）は、そのまま使います`)
  } catch {
    // PDF保存先を設定していない
  }
  return report
}

async function main(argv) {
  const newDir = path.dirname(fileURLToPath(import.meta.url))
  // 入力は届いた順にためておき、聞いたときに1行ずつ使う（聞く前に届いた行を落とさないため）
  const rl = readline.createInterface({ input: process.stdin })
  const lines = []
  const waiting = []
  rl.on('line', (l) => (waiting.length ? waiting.shift()(l) : lines.push(l)))
  rl.on('close', () => waiting.splice(0).forEach((r) => r('')))
  const ask = (q) => {
    process.stdout.write(q)
    return lines.length ? Promise.resolve(lines.shift()) : new Promise((r) => waiting.push(r))
  }
  console.log('============================================')
  console.log(` ${APP_TITLE} データ引き継ぎ`)
  console.log('============================================')
  console.log(`新しい版のフォルダ: ${newDir}`)
  console.log('')
  try {
    const raw = argv[2] ?? await ask('古い版のフォルダの場所を入れて Enter を押してください（フォルダをこの窓へドラッグしても入ります）\n> ')
    const oldDir = raw.trim().replace(/^"|"$/g, '')
    let overwrite = false
    let report
    for (;;) {
      try {
        report = await migrate(oldDir, newDir, { overwrite })
        break
      } catch (e) {
        if (!(e instanceof MigrateError)) throw e
        console.log('')
        console.log('[止めました] ' + e.message)
        if (e.message.includes('すでにモデルや設定') && !overwrite) {
          const ans = await ask('古いフォルダの内容で上書きしますか？（新しいフォルダにあったものは「見本データ」に残します） y / n > ')
          if (ans.trim().toLowerCase() === 'y') {
            overwrite = true
            continue
          }
        }
        console.log('何も写していません。')
        return 1
      }
    }
    console.log('')
    for (const line of report) console.log('  ' + line)
    console.log('')
    console.log('引き継ぎが終わりました。古いフォルダはそのまま残っています。')
    console.log('次に「初回セットアップ.bat」、そのあと「ビューア起動.bat」を実行してください。')
    return 0
  } finally {
    rl.close()
  }
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv)
}
