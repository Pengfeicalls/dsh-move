/**
 * dsh-move — host 半区（静态 profile 插件）
 *
 * 设置栏「搬家」页面后端：打包 / 导入，直接调用 dsh-move.mjs 引擎
 * （进程内 spawn node dsh-move.mjs pack/unpack）。
 * 通过 webServer 注册同源 HTTP 路由供 client fetch 调用；完整 Node 环境，零第三方依赖。
 *
 * 路由：
 *   POST /dsh-move/list-sessions      会话 + 工程（cwd）列表
 *   POST /dsh-move/pack               启动打包任务 → { jobId }
 *   POST /dsh-move/job-wait           阻塞等待任务进度（≤timeoutMs）→ { status, log, result }
 *   POST /dsh-move/preview            解包 manifest 预览
 *   POST /dsh-move/import             启动还原任务 → { jobId }
 *   POST /dsh-move/upload-begin/chunk/finalize/abort    zip 分片上传
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, statSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

export const name = 'dsh-move'
export const inject = ['webServer']

const MAX_JOB_LOG = 200000
const UPLOAD_CAP = 32 * 1024 * 1024 // readBody 上限（分片 base64 约 5.6MB）

// ---------------------------------------------------------------- 引擎定位
function locateEngine() {
  const candidates = [
    process.env.DSH_MOVE_DIR ? join(process.env.DSH_MOVE_DIR, 'dsh-move.mjs') : null,
    join(process.cwd(), 'dsh-move', 'dsh-move.mjs'),
    'D:\\Deepseek Harness\\engineer\\dsh-move\\dsh-move.mjs',
  ].filter(Boolean)
  for (const c of candidates) {
    try { if (c && existsSync(c)) return c } catch { /* ignore */ }
  }
  return null
}

// ---------------------------------------------------------------- 临时目录（上传分片 / 预览）
function tmpRoot() { return join(homedir(), '.dsh', 'dsh-move', 'tmp') }
function ensureTmp() { try { mkdirSync(tmpRoot(), { recursive: true }) } catch { /* ignore */ } return tmpRoot() }
function cleanupTmp() { try { rmSync(tmpRoot(), { recursive: true, force: true }) } catch { /* ignore */ } }

// ---------------------------------------------------------------- 后台任务
const jobs = new Map()
let jobSeq = 0

function startJob(kind, argv, opts) {
  const id = 'dshmove-job-' + (++jobSeq)
  const job = { id, kind, status: 'running', log: '', exitCode: null, error: null, result: null }
  jobs.set(id, job)
  let proc
  try {
    proc = spawn(argv[0], argv.slice(1), {
      cwd: opts && opts.cwd ? opts.cwd : process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (e) {
    job.status = 'error'
    job.error = String((e && e.message) || e)
    return id
  }
  job.proc = proc
  const push = (chunk) => {
    try {
      job.log += chunk.toString('utf8')
      if (job.log.length > MAX_JOB_LOG) job.log = '…(前段日志已省略)\n' + job.log.slice(-MAX_JOB_LOG)
    } catch { /* ignore */ }
  }
  proc.stdout.on('data', push)
  proc.stderr.on('data', push)
  proc.on('error', (e) => { job.status = 'error'; job.error = String((e && e.message) || e) })
  proc.on('close', (code, signal) => {
    job.exitCode = code
    job.status = code === 0 ? 'done' : 'error'
    if (job.status === 'error') job.error = '进程退出码 ' + String(code) + (signal ? '（signal ' + signal + '）' : '')
    try {
      if (kind === 'pack' && opts && opts.outPath) {
        job.result = { outPath: opts.outPath, sizeBytes: null }
        try { job.result.sizeBytes = statSync(opts.outPath).size } catch { /* ignore */ }
      } else if (kind === 'import') {
        job.result = { done: job.status === 'done' }
      }
    } catch { /* ignore */ }
  })
  return id
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }
function waitClose(proc) {
  return new Promise((r) => {
    if (proc.exitCode !== null || proc.signalCode !== null) r()
    else proc.once('close', r)
  })
}

// ---------------------------------------------------------------- HTTP 辅助（同源保护，参考 dsh-github-flow）
function sameOrigin(req) {
  const origin = req.headers.origin
  if (!origin) return true
  try {
    const u = new URL(origin)
    return u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '::1'
  } catch { return false }
}
function routeGuard(req, res) {
  if (!sameOrigin(req)) { json(res, 403, { error: 'forbidden' }); return false }
  return true
}
function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data))
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = ''
    req.on('data', (c) => { d += c; if (d.length > UPLOAD_CAP) { req.destroy(); reject(new Error('body too large')) } })
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}) } catch (e) { reject(e) } })
    req.on('error', reject)
  })
}

// ---------------------------------------------------------------- 会话 / 工程列表
async function listSessions(ctx) {
  const sq = ctx.get('sessionQuery')
  const sessions = []
  let projects = []
  if (sq !== undefined) {
    try {
      const records = await sq.listSessions()
      for (const rec of records || []) {
        const h = rec && rec.header
        if (!h || !h.id) continue
        sessions.push({ id: h.id, cwd: h.cwd || null, createdAt: h.createdAt || null, title: null })
      }
    } catch { /* ignore */ }
    try {
      if (sessions.length > 0) {
        const obs = await sq.readTitleSnapshots(sessions.map((s) => s.id))
        const byId = new Map()
        for (const o of obs || []) {
          if (!o || o.status !== 'fulfilled' || !o.value) continue
          const t = o.value.title
          let title = null
          if (typeof t === 'string') title = t
          else if (t && typeof t === 'object' && 'title' in t) title = t.title || null
          byId.set(o.sessionId, title)
        }
        for (const s of sessions) s.title = byId.get(s.id) || null
      }
    } catch { /* ignore */ }
    const cwdSet = new Set()
    for (const s of sessions) if (s.cwd) cwdSet.add(s.cwd)
    projects = [...cwdSet]
  }
  return { ok: true, sessions, projects }
}

// ---------------------------------------------------------------- 路由
function registerRoutes(ctx) {
  const webServer = ctx.get('webServer')
  if (!webServer) return
  const disposers = []
  const route = (path, handler) => disposers.push(webServer.register({ kind: 'exact', path, handler }))

  route('/dsh-move/list-sessions', async (req, res) => {
    if (!routeGuard(req, res)) return
    try { json(res, 200, await listSessions(ctx)) } catch (e) { json(res, 500, { ok: false, error: String((e && e.message) || e) }) }
  })

  route('/dsh-move/pack', async (req, res) => {
    if (!routeGuard(req, res)) return
    try {
      const body = await readBody(req)
      const projects = Array.isArray(body.projects) ? body.projects.filter((p) => typeof p === 'string' && p.trim()) : []
      if (projects.length === 0) { json(res, 200, { ok: false, error: '请至少选择一个工程目录' }); return }
      const engine = locateEngine()
      if (!engine) { json(res, 200, { ok: false, error: '找不到 dsh-move.mjs 引擎（可设置环境变量 DSH_MOVE_DIR）' }); return }
      const argv = [process.execPath, engine, 'pack']
      const out = typeof body.out === 'string' && body.out.trim() ? body.out.trim() : null
      if (out) argv.push('--out', out)
      if (body.shell === false) argv.push('--no-shell')
      const sessionIds = Array.isArray(body.sessionIds) ? body.sessionIds.filter((s) => typeof s === 'string' && s) : null
      if (sessionIds !== null) {
        if (sessionIds.length === 0) argv.push('--no-sessions')
        else argv.push('--sessions', sessionIds.join(';'))
      }
      argv.push('--no-auto-projects')
      for (const p of projects) argv.push('--projects', p)
      if (body.slim === true) argv.push('--slim')
      json(res, 200, { ok: true, jobId: startJob('pack', argv, { outPath: out }) })
    } catch (e) { json(res, 500, { ok: false, error: String((e && e.message) || e) }) }
  })

  route('/dsh-move/job-wait', async (req, res) => {
    if (!routeGuard(req, res)) return
    try {
      const body = await readBody(req)
      const job = jobs.get(String((body && body.jobId) || ''))
      if (!job) { json(res, 200, { ok: false, error: '未知任务: ' + String(body && body.jobId) }); return }
      if (job.status === 'running' && job.proc) {
        const ms = Math.min(Math.max(Number(body && body.timeoutMs) || 15000, 500), 60000)
        await Promise.race([waitClose(job.proc), sleep(ms)])
      }
      json(res, 200, { ok: true, status: job.status, log: job.log, error: job.error, result: job.result })
    } catch (e) { json(res, 500, { ok: false, error: String((e && e.message) || e) }) }
  })

  route('/dsh-move/preview', async (req, res) => {
    if (!routeGuard(req, res)) return
    try {
      const body = await readBody(req)
      const zipPath = String((body && body.zipPath) || '')
      if (!zipPath || !existsSync(zipPath)) { json(res, 200, { ok: false, error: '文件不存在: ' + zipPath }); return }
      const zipSize = statSync(zipPath).size
      const previewDir = join(ensureTmp(), 'preview-' + Date.now())
      mkdirSync(previewDir, { recursive: true })
      try {
        const xr = spawnSync('tar', ['-xf', zipPath, '-C', previewDir, 'dsh-move-backup/manifest.json'], { encoding: 'utf8' })
        if (xr.error || xr.status !== 0) { json(res, 200, { ok: false, error: '包内缺少 manifest.json（可能不是 dsh-move 生成的包）' }); return }
        const manifest = JSON.parse(readFileSync(join(previewDir, 'dsh-move-backup', 'manifest.json'), 'utf8'))
        const lr = spawnSync('tar', ['-tf', zipPath], { encoding: 'utf8', maxBuffer: 67108864 })
        const entries = (lr.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
        const entriesTop = {}
        for (const e of entries) { const top = e.split('/')[0]; if (top) entriesTop[top] = (entriesTop[top] || 0) + 1 }
        const defaults = {
          home: process.env.USERPROFILE ? join(process.env.USERPROFILE, '.dsh') : null,
          npm: process.env.APPDATA ? join(process.env.APPDATA, 'npm') : null,
          projectsRoot: null,
        }
        const projs = manifest.included && Array.isArray(manifest.included.projects) ? manifest.included.projects : []
        if (projs.length > 0) defaults.projectsRoot = dirname(projs[0])
        json(res, 200, { ok: true, manifest, zipSize, entryCount: entries.length, entriesTop, defaults })
      } finally {
        try { rmSync(previewDir, { recursive: true, force: true }) } catch { /* ignore */ }
      }
    } catch (e) { json(res, 500, { ok: false, error: String((e && e.message) || e) }) }
  })

  route('/dsh-move/import', async (req, res) => {
    if (!routeGuard(req, res)) return
    try {
      const body = await readBody(req)
      const zipPath = String((body && body.zipPath) || '')
      if (!zipPath || !existsSync(zipPath)) { json(res, 200, { ok: false, error: '文件不存在: ' + zipPath }); return }
      const engine = locateEngine()
      if (!engine) { json(res, 200, { ok: false, error: '找不到 dsh-move.mjs 引擎' }); return }
      const argv = [process.execPath, engine, 'unpack', zipPath]
      if (typeof body.home === 'string' && body.home.trim()) argv.push('--home', body.home.trim())
      if (typeof body.projectsRoot === 'string' && body.projectsRoot.trim()) argv.push('--projects-root', body.projectsRoot.trim())
      if (typeof body.npm === 'string' && body.npm.trim()) argv.push('--npm', body.npm.trim())
      json(res, 200, { ok: true, jobId: startJob('import', argv, {}) })
    } catch (e) { json(res, 500, { ok: false, error: String((e && e.message) || e) }) }
  })

  // ---- 上传（分片 base64）----
  const uploads = new Map()
  let uploadSeq = 0

  route('/dsh-move/upload-begin', async (req, res) => {
    if (!routeGuard(req, res)) return
    try {
      for (const u of [...uploads.values()]) { try { rmSync(u.partDir, { recursive: true, force: true }) } catch { /* ignore */ } }
      uploads.clear()
      const id = 'up' + (++uploadSeq)
      const partDir = join(ensureTmp(), id)
      mkdirSync(partDir, { recursive: true })
      uploads.set(id, { partDir, parts: 0 })
      json(res, 200, { ok: true, uploadId: id })
    } catch (e) { json(res, 500, { ok: false, error: String((e && e.message) || e) }) }
  })

  route('/dsh-move/upload-chunk', async (req, res) => {
    if (!routeGuard(req, res)) return
    try {
      const body = await readBody(req)
      const u = uploads.get(String((body && body.uploadId) || ''))
      if (!u) { json(res, 200, { ok: false, error: '未知上传: ' + String(body && body.uploadId) }); return }
      const index = Number(body && body.index)
      const data = String((body && body.data) || '')
      if (!Number.isFinite(index) || index < 0 || !data) { json(res, 200, { ok: false, error: '无效的分片参数' }); return }
      writeFileSync(join(u.partDir, 'part-' + String(index).padStart(6, '0') + '.part'), data, 'utf8')
      u.parts++
      json(res, 200, { ok: true, received: index })
    } catch (e) { json(res, 500, { ok: false, error: String((e && e.message) || e) }) }
  })

  route('/dsh-move/upload-finalize', async (req, res) => {
    if (!routeGuard(req, res)) return
    try {
      const body = await readBody(req)
      const u = uploads.get(String((body && body.uploadId) || ''))
      if (!u) { json(res, 200, { ok: false, error: '未知上传: ' + String(body && body.uploadId) }); return }
      if (u.parts === 0) { json(res, 200, { ok: false, error: '没有收到任何数据' }); return }
      const parts = readdirSync(u.partDir).filter((f) => f.endsWith('.part')).sort()
      const b64 = parts.map((f) => readFileSync(join(u.partDir, f), 'utf8')).join('')
      const zipPath = join(ensureTmp(), u.uploadId + '.zip')
      writeFileSync(zipPath, Buffer.from(b64, 'base64'))
      json(res, 200, { ok: true, zipPath, size: statSync(zipPath).size })
    } catch (e) { json(res, 500, { ok: false, error: String((e && e.message) || e) }) }
  })

  route('/dsh-move/upload-abort', async (req, res) => {
    if (!routeGuard(req, res)) return
    try {
      const body = await readBody(req)
      const u = uploads.get(String((body && body.uploadId) || ''))
      if (u) {
        try { rmSync(u.partDir, { recursive: true, force: true }) } catch { /* ignore */ }
        uploads.delete(u.uploadId)
      }
      json(res, 200, { ok: true })
    } catch (e) { json(res, 500, { ok: false, error: String((e && e.message) || e) }) }
  })

  ctx.on('dispose', () => { for (const d of disposers) { try { d() } catch { /* ignore */ } } })
}

export const apply = (ctx) => {
  registerRoutes(ctx)
  ctx.on('dispose', () => { try { cleanupTmp() } catch { /* ignore */ } })
}
