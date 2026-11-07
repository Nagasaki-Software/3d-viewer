/** viewer/models/ のGLB一覧・配信・注釈JSON保存。
 * 開発サーバー（vite.config.js）と本番配信サーバー（server.js）の両方から使う。
 */
import fs from 'node:fs'
import path from 'node:path'

// models/ 内のファイル名として安全か（パス区切り・..を拒否、glb/jsonのみ）
export function isSafeFileName(name) {
  return /^[^/\\]+\.(glb|json)$/i.test(name) && !name.includes('..')
}

/** GLBの一覧（名前・サイズ・注釈JSONの有無）を返す。フォルダ未作成なら空。
 * LOD(軽量表示)用の"_lod.glb"と中間版の"_mid.glb"は単体では意味を持たない付属ファイルのため、
 * ギャラリー一覧には出さない（配信自体はhandleModelFileで引き続き可能） */
export function listModels(modelsDir) {
  let files = []
  try {
    files = fs.readdirSync(modelsDir)
      .filter((f) => f.toLowerCase().endsWith('.glb') && !/_(lod|mid)\.glb$/i.test(f))
  } catch {
    return []
  }
  return files.map((f) => {
    const base = f.replace(/\.glb$/i, '')
    return {
      name: base,
      size: fs.statSync(path.join(modelsDir, f)).size,
      hasAnnotations: fs.existsSync(path.join(modelsDir, `${base}_annotations.json`)),
    }
  })
}

/** GET /api/models 相当。一覧をJSONで書き出す */
export function handleModelsList(modelsDir, req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(listModels(modelsDir)))
}

/** GET/PUT /models/<name> 相当。GETはETag/304対応、PUTは注釈JSONのみ許可 */
export function handleModelFile(modelsDir, name, req, res) {
  if (!isSafeFileName(name)) {
    res.statusCode = 400
    res.end('invalid name')
    return
  }
  const file = path.join(modelsDir, name)

  if (req.method === 'PUT') {
    if (!name.toLowerCase().endsWith('.json')) {
      res.statusCode = 403
      res.end('only .json files can be written')
      return
    }
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      try {
        JSON.parse(body) // 妥当なJSONか確認するのみ（中身の詳細検証はクライアント側で実施済み）
      } catch {
        res.statusCode = 400
        res.end('invalid JSON')
        return
      }
      fs.mkdirSync(modelsDir, { recursive: true })
      fs.writeFileSync(file, body, 'utf8')
      res.statusCode = 200
      res.end('ok')
    })
    return
  }

  if (!fs.existsSync(file)) {
    res.statusCode = 404
    res.end('not found')
    return
  }
  const st = fs.statSync(file)
  // 内容が変わらない限り2回目以降の転送を省略する（LAN経由の再読み込み高速化）
  const etag = `"${st.size}-${Math.round(st.mtimeMs)}"`
  res.setHeader('ETag', etag)
  if (req.headers['if-none-match'] === etag) {
    res.statusCode = 304
    res.end()
    return
  }
  res.setHeader('Content-Type',
    name.toLowerCase().endsWith('.glb') ? 'model/gltf-binary' : 'application/json; charset=utf-8')
  res.setHeader('Content-Length', st.size)
  fs.createReadStream(file).pipe(res)
}
