/**
 * dsh-move — client bundle（纯 JS，免构建）
 *
 * 挂在 settings.section 插槽（设置侧栏自动列出「搬家」页面），提供 打包 / 导入 两个功能。
 * 后端是同一包 host 半区注册的 /dsh-move/* 同源路由，用 fetch 调用。
 */
window.__ModuleLoader__.load({
  id: 'dsh-move',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { useState, useEffect, useRef } = React
    const h = React.createElement

    // 组件通过它访问 client 服务（apply 注入）
    let clientCtx = null

    const CHUNK_BYTES = 4 * 1024 * 1024

    // ------------------------------------------------------------ fetch
    async function api(path, body) {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
      })
      let data = null
      try { data = await res.json() } catch (e) { /* ignore */ }
      if (!res.ok) throw new Error((data && data.error) || `请求失败 ${res.status}`)
      return data
    }

    // ------------------------------------------------------------ 页面骨架
    function DshMoveSection() {
      const [tab, setTab] = useState('pack')
      return h('div', { className: 'dshmove-root' },
        h('style', null, CSS),
        h('div', { className: 'dshmove-head' },
          h('div', { className: 'dshmove-title' }, '搬家（dsh-move）'),
          h('div', { className: 'dshmove-sub' }, '备份会话历史 / DSH 壳 / 工程为 zip，并在新电脑上还原'),
        ),
        h('div', { className: 'dshmove-tabs' },
          h('button', { type: 'button', className: 'dshmove-tab' + (tab === 'pack' ? ' dshmove-tab-active' : ''), onClick: () => setTab('pack') }, '打包'),
          h('button', { type: 'button', className: 'dshmove-tab' + (tab === 'import' ? ' dshmove-tab-active' : ''), onClick: () => setTab('import') }, '导入'),
        ),
        tab === 'pack' ? h(PackPanel, null) : h(ImportPanel, null),
      )
    }

    // ------------------------------------------------------------ 打包
    function PackPanel() {
      const [loading, setLoading] = useState(true)
      const [loadError, setLoadError] = useState(null)
      const [projects, setProjects] = useState([])
      const [sessions, setSessions] = useState([])
      const [selProjects, setSelProjects] = useState(null)
      const [selSessions, setSelSessions] = useState(null)
      const [shellOn, setShellOn] = useState(true)
      const [slim, setSlim] = useState(false)
      const [outPath, setOutPath] = useState('')
      const [job, setJob] = useState(null)
      const workspaces = clientCtx ? clientCtx.get('workspaces') : null

      useEffect(() => {
        let alive = true
        api('/dsh-move/list-sessions', {}).then((res) => {
          if (!alive) return
          if (!res || res.ok !== true) {
            setLoadError((res && res.error) || '无法读取会话/工程列表')
            setLoading(false)
            return
          }
          setProjects(res.projects || [])
          setSessions(res.sessions || [])
          setSelProjects(new Set(res.projects || []))
          setSelSessions(new Set((res.sessions || []).map((s) => s.id)))
          if ((res.projects || []).length > 0) {
            setOutPath(parentOf(res.projects[0]) + '\\dsh-move-backup-' + stamp() + '.zip')
          }
          setLoading(false)
        }).catch((e) => {
          if (!alive) return
          setLoadError(String((e && e.message) || e))
          setLoading(false)
        })
        return () => { alive = false }
      }, [])

      useEffect(() => {
        if (!job || !job.running || !job.jobId) return
        const jobId = job.jobId
        let alive = true
        const loop = async () => {
          try {
            while (alive) {
              const res = await api('/dsh-move/job-wait', { jobId, timeoutMs: 15000 })
              if (!alive) return
              if (!res || res.ok !== true) {
                setJob({ jobId, running: false, done: false, log: '', result: null, error: (res && res.error) || '查询任务失败' })
                return
              }
              if (res.status === 'done' || res.status === 'error') {
                setJob({ jobId, running: false, done: res.status === 'done', log: res.log || '', result: res.result || null, error: res.error || null })
                return
              }
              setJob((j) => (j && j.running && j.jobId === jobId ? { ...j, log: res.log || '' } : j))
            }
          } catch (e) {
            if (alive) setJob((j) => (j && j.jobId === jobId ? { ...j, running: false, done: false, error: String((e && e.message) || e) } : j))
          }
        }
        loop()
        return () => { alive = false }
      }, [job && job.jobId, job && job.running])

      const canPack = selProjects !== null && selProjects.size > 0 && (!job || !job.running)

      const onPack = async () => {
        if (!canPack) return
        setJob({ jobId: null, running: true, done: false, log: '正在启动打包…', result: null, error: null })
        try {
          const res = await api('/dsh-move/pack', {
            projects: [...selProjects],
            sessionIds: selSessions ? [...selSessions] : null,
            shell: shellOn,
            out: outPath,
            slim,
          })
          if (!res || res.ok !== true) {
            setJob({ jobId: null, running: false, done: false, log: '', result: null, error: (res && res.error) || '打包启动失败' })
            return
          }
          setJob({ jobId: res.jobId, running: true, done: false, log: '打包进行中…', result: null, error: null })
        } catch (e) {
          setJob({ jobId: null, running: false, done: false, log: '', result: null, error: String((e && e.message) || e) })
        }
      }

      const onPickOutDir = async () => {
        if (!workspaces) return
        try {
          const dir = await workspaces.pickDirectory()
          if (dir) setOutPath(dir.replace(/[\\/]+$/, '') + '\\dsh-move-backup-' + stamp() + '.zip')
        } catch (e) { /* ignore */ }
      }

      const toggleIn = (setter, set, value) => {
        const s = new Set(set)
        if (s.has(value)) s.delete(value); else s.add(value)
        setter(s)
      }

      return h('div', { className: 'dshmove-panel' },
        loading ? h('div', { className: 'dshmove-muted' }, '正在读取会话历史…') :
        loadError ? h('div', { className: 'dshmove-error' }, loadError) :
        h('div', { className: 'dshmove-form' },
          h('div', { className: 'dshmove-group' },
            h('div', { className: 'dshmove-group-head' },
              h('span', { className: 'dshmove-group-title' }, '工程目录（必选，可多选）'),
              h('button', { type: 'button', className: 'dshmove-link', onClick: () => setSelProjects(new Set(projects)) }, '全选'),
              h('button', { type: 'button', className: 'dshmove-link', onClick: () => setSelProjects(new Set()) }, '清空'),
            ),
            h('div', { className: 'dshmove-list' },
              projects.length === 0
                ? h('div', { className: 'dshmove-muted' }, '未在会话历史中发现工程目录（可在打包前先创建会话并进入工作目录）')
                : projects.map((p) => h('label', { key: p, className: 'dshmove-row' },
                    h('input', { type: 'checkbox', checked: selProjects !== null && selProjects.has(p), onChange: () => toggleIn(setSelProjects, selProjects, p) }),
                    h('span', { className: 'dshmove-row-label', title: p }, p),
                  )),
            ),
            selProjects !== null && selProjects.size === 0
              ? h('div', { className: 'dshmove-warn' }, '请至少选择一个工程目录，否则无法打包')
              : null,
          ),

          h('div', { className: 'dshmove-group' },
            h('div', { className: 'dshmove-group-head' },
              h('span', { className: 'dshmove-group-title' }, '对话 / 会话（可选，可多选）'),
              h('button', { type: 'button', className: 'dshmove-link', onClick: () => setSelSessions(new Set(sessions.map((s) => s.id))) }, '全选'),
              h('button', { type: 'button', className: 'dshmove-link', onClick: () => setSelSessions(new Set()) }, '全不选'),
            ),
            h('div', { className: 'dshmove-list' },
              sessions.length === 0
                ? h('div', { className: 'dshmove-muted' }, '没有可打包的会话')
                : sessions.map((s) => h('label', { key: s.id, className: 'dshmove-row' },
                    h('input', { type: 'checkbox', checked: selSessions !== null && selSessions.has(s.id), onChange: () => toggleIn(setSelSessions, selSessions, s.id) }),
                    h('span', { className: 'dshmove-row-label', title: (s.cwd || '') },
                      h('span', { className: 'dshmove-sess-title' }, s.title || s.id),
                      h('span', { className: 'dshmove-sess-sub' }, s.cwd ? 'cwd: ' + s.cwd : s.id),
                    ),
                  )),
            ),
            h('div', { className: 'dshmove-hint' }, '默认全选；全部取消时打包只带工程和 DSH 壳，不带历史。'),
          ),

          h('div', { className: 'dshmove-group' },
            h('label', { className: 'dshmove-row' },
              h('input', { type: 'checkbox', checked: shellOn, onChange: (e) => setShellOn(e.target.checked) }),
              h('span', { className: 'dshmove-row-label' }, '包含 DSH 壳（软件本体）'),
            ),
            h('div', { className: 'dshmove-hint' }, shellOn ? '目标机可直接解压运行 restore.cmd 还原。' : '不勾选 → 只打对话 + 工程，目标机需在线重装 DSH。'),
            h('label', { className: 'dshmove-row' },
              h('input', { type: 'checkbox', checked: slim, onChange: (e) => setSlim(e.target.checked) }),
              h('span', { className: 'dshmove-row-label' }, '精简模式（跳过 node_modules / .git / dist 等，体积更小）'),
            ),
          ),

          h('div', { className: 'dshmove-group' },
            h('div', { className: 'dshmove-group-title' }, '输出 zip 路径'),
            h('div', { className: 'dshmove-row' },
              h('input', { className: 'dshmove-input', value: outPath, onChange: (e) => setOutPath(e.target.value), placeholder: 'D:\\...\\dsh-move-backup-<日期>.zip' }),
              h('button', { type: 'button', className: 'dshmove-btn', onClick: onPickOutDir, disabled: !workspaces }, '选择目录'),
            ),
            h('div', { className: 'dshmove-hint' }, '建议放在工程目录上级，避免把 zip 打进工程里。'),
          ),

          h('button', { type: 'button', className: 'dshmove-btn dshmove-primary', disabled: !canPack, onClick: onPack }, '开始打包'),
          h('div', { className: 'dshmove-hint' }, '打包耗时取决于工程大小（约 5 分钟/GB 量级）；API key（.credentials.yaml）默认不会带出。'),
          jobArea(job),
        ),
      )
    }

    // ------------------------------------------------------------ 导入
    function ImportPanel() {
      const [mode, setMode] = useState('file')
      const fileRef = useRef(null)
      const [file, setFile] = useState(null)
      const [dragOver, setDragOver] = useState(false)
      const [pathInput, setPathInput] = useState('')
      const [uploading, setUploading] = useState(false)
      const [uploadProgress, setUploadProgress] = useState(0)
      const [zipPath, setZipPath] = useState(null)
      const [preview, setPreview] = useState(null)
      const [previewError, setPreviewError] = useState(null)
      const [home, setHome] = useState('')
      const [projectsRoot, setProjectsRoot] = useState('')
      const [npm, setNpm] = useState('')
      const [job, setJob] = useState(null)
      const workspaces = clientCtx ? clientCtx.get('workspaces') : null

      useEffect(() => {
        if (!job || !job.running || !job.jobId) return
        const jobId = job.jobId
        let alive = true
        const loop = async () => {
          try {
            while (alive) {
              const res = await api('/dsh-move/job-wait', { jobId, timeoutMs: 15000 })
              if (!alive) return
              if (!res || res.ok !== true) {
                setJob({ jobId, running: false, done: false, log: '', result: null, error: (res && res.error) || '查询任务失败' })
                return
              }
              if (res.status === 'done' || res.status === 'error') {
                setJob({ jobId, running: false, done: res.status === 'done', log: res.log || '', result: res.result || null, error: res.error || null })
                return
              }
              setJob((j) => (j && j.running && j.jobId === jobId ? { ...j, log: res.log || '' } : j))
            }
          } catch (e) {
            if (alive) setJob((j) => (j && j.jobId === jobId ? { ...j, running: false, done: false, error: String((e && e.message) || e) } : j))
          }
        }
        loop()
        return () => { alive = false }
      }, [job && job.jobId, job && job.running])

      const getFile = () => file

      const onFileChange = (e) => {
        const f = e.target.files && e.target.files[0]
        if (f) { setFile(f); e.target.value = '' } // 清空以便再次选择同一文件
      }

      const pickFile = () => { if (fileRef.current) fileRef.current.click() }
      const onDropZoneDragOver = (e) => { e.preventDefault(); setDragOver(true) }
      const onDropZoneDragLeave = (e) => { e.preventDefault(); setDragOver(false) }
      const onDropZoneDrop = (e) => {
        e.preventDefault()
        setDragOver(false)
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]
        if (f) setFile(f)
      }
      const removeFile = (e) => { e.stopPropagation(); setFile(null) }

      const doPreview = async (p) => {
        try {
          const res = await api('/dsh-move/preview', { zipPath: p })
          if (!res || res.ok !== true) { setPreviewError((res && res.error) || '预览失败'); return }
          setPreview(res)
          if (res.defaults) {
            if (res.defaults.home) setHome((v) => v || res.defaults.home)
            if (res.defaults.projectsRoot) setProjectsRoot((v) => v || res.defaults.projectsRoot)
            if (res.defaults.npm) setNpm((v) => v || res.defaults.npm)
          }
          setPreviewError(null)
        } catch (e) {
          setPreviewError(String((e && e.message) || e))
        }
      }

      const onUpload = async () => {
        const f = getFile()
        if (!f) { setPreviewError('请先选择 zip 文件'); return }
        setUploading(true)
        setUploadProgress(0)
        setPreviewError(null)
        setPreview(null)
        try {
          const begin = await api('/dsh-move/upload-begin', { name: f.name, size: f.size })
          if (!begin || begin.ok !== true) throw new Error((begin && begin.error) || '上传初始化失败')
          const uploadId = begin.uploadId
          const total = Math.max(1, Math.ceil(f.size / CHUNK_BYTES))
          for (let i = 0; i < total; i++) {
            const blob = f.slice(i * CHUNK_BYTES, Math.min((i + 1) * CHUNK_BYTES, f.size))
            const buf = await blob.arrayBuffer()
            const b64 = bytesToBase64(new Uint8Array(buf))
            const res = await api('/dsh-move/upload-chunk', { uploadId, index: i, data: b64 })
            if (!res || res.ok !== true) throw new Error((res && res.error) || ('分片 ' + i + ' 上传失败'))
            setUploadProgress(Math.round(((i + 1) / total) * 100))
          }
          const fin = await api('/dsh-move/upload-finalize', { uploadId })
          if (!fin || fin.ok !== true) throw new Error((fin && fin.error) || '上传收尾失败')
          setZipPath(fin.zipPath)
          await doPreview(fin.zipPath)
        } catch (e) {
          setPreviewError(String((e && e.message) || e))
        } finally {
          setUploading(false)
        }
      }

      const onPathPreview = async () => {
        const p = pathInput.trim()
        if (!p) { setPreviewError('请输入 zip 文件路径'); return }
        setPreviewError(null)
        setPreview(null)
        setZipPath(p)
        await doPreview(p)
      }

      const onImport = async () => {
        if (!zipPath) { setPreviewError('请先选择并预览 zip 文件'); return }
        setJob({ jobId: null, running: true, done: false, log: '正在启动还原…', result: null, error: null })
        try {
          const res = await api('/dsh-move/import', {
            zipPath,
            home: home.trim() || undefined,
            projectsRoot: projectsRoot.trim() || undefined,
            npm: npm.trim() || undefined,
          })
          if (!res || res.ok !== true) {
            setJob({ jobId: null, running: false, done: false, log: '', result: null, error: (res && res.error) || '还原启动失败' })
            return
          }
          setJob({ jobId: res.jobId, running: true, done: false, log: '还原进行中…', result: null, error: null })
        } catch (e) {
          setJob({ jobId: null, running: false, done: false, log: '', result: null, error: String((e && e.message) || e) })
        }
      }

      const pickInto = async (setter) => {
        if (!workspaces) return
        try {
          const dir = await workspaces.pickDirectory()
          if (dir) setter(dir)
        } catch (e) { /* ignore */ }
      }

      const m = preview && preview.manifest ? preview.manifest : null
      const inc = m && m.included ? m.included : {}
      const src = m && m.source ? m.source : {}

      return h('div', { className: 'dshmove-panel' },
        h('div', { className: 'dshmove-group' },
          h('div', { className: 'dshmove-group-title' }, '1. 选择搬家包（必须是 dsh-move 打包产物）'),
          h('div', { className: 'dshmove-tabs dshmove-tabs-sm' },
            h('button', { type: 'button', className: 'dshmove-tab' + (mode === 'file' ? ' dshmove-tab-active' : ''), onClick: () => setMode('file') }, '选择文件'),
            h('button', { type: 'button', className: 'dshmove-tab' + (mode === 'path' ? ' dshmove-tab-active' : ''), onClick: () => setMode('path') }, '直接输入路径'),
          ),
          mode === 'file'
            ? h('div', { className: 'dshmove-uploader' },
                h('div', {
                  className: 'dshmove-dropzone' + (dragOver ? ' dshmove-dropzone-drag' : ''),
                  role: 'button',
                  tabIndex: 0,
                  onClick: pickFile,
                  onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickFile() } },
                  onDragOver: onDropZoneDragOver,
                  onDragLeave: onDropZoneDragLeave,
                  onDrop: onDropZoneDrop,
                },
                  h('input', { ref: fileRef, type: 'file', accept: '.zip', className: 'dshmove-file-input', onChange: onFileChange, tabIndex: -1 }),
                  file
                    ? h('div', { className: 'dshmove-file-chip' },
                        h('span', { className: 'dshmove-file-chip-icon' }, '📦'),
                        h('span', { className: 'dshmove-file-chip-name', title: file.name }, file.name),
                        h('span', { className: 'dshmove-file-chip-size' }, formatBytes(file.size)),
                        h('button', { type: 'button', className: 'dshmove-file-chip-x', onClick: removeFile, 'aria-label': '移除已选文件' }, '✕'),
                      )
                    : h('div', { className: 'dshmove-dropzone-empty' },
                        h('div', { className: 'dshmove-dropzone-icon' }, '📂'),
                        h('div', { className: 'dshmove-dropzone-title' }, '点击选择 zip 文件'),
                        h('div', { className: 'dshmove-dropzone-sub' }, '或拖拽文件到此处 · 仅支持 dsh-move 打包产物（.zip）'),
                      ),
                ),
                h('div', { className: 'dshmove-row dshmove-row-end' },
                  h('button', { type: 'button', className: 'dshmove-btn dshmove-primary', disabled: !file || uploading || (job && job.running), onClick: onUpload },
                    uploading ? '上传中 ' + uploadProgress + '%' : '上传并预览',
                  ),
                ),
              )
            : h('div', { className: 'dshmove-row' },
                h('input', { className: 'dshmove-input', value: pathInput, onChange: (e) => setPathInput(e.target.value), placeholder: '如 D:\\backup\\dsh-move-backup-20260101.zip' }),
                h('button', { type: 'button', className: 'dshmove-btn dshmove-primary', onClick: onPathPreview }, '读取预览'),
              ),
          uploading
            ? h('div', { className: 'dshmove-progress' },
                h('div', { className: 'dshmove-progress-fill', style: { width: uploadProgress + '%' } }))
            : null,
          previewError ? h('div', { className: 'dshmove-error' }, previewError) : null,
        ),

        preview
          ? h('div', { className: 'dshmove-card' },
              h('div', { className: 'dshmove-card-title' }, '包内容预览'),
              h('div', { className: 'dshmove-kv' },
                h('div', null, h('span', { className: 'dshmove-k' }, '打包时间：'), h('span', null, m.createdAt || '未知')),
                h('div', null, h('span', { className: 'dshmove-k' }, '来源机器：'), h('span', null, (src.hostname || '未知') + (src.platform ? ' / ' + src.platform : ''))),
                h('div', null, h('span', { className: 'dshmove-k' }, '对话历史：'), h('span', null, inc.sessions ? '包含' : '不包含')),
                h('div', null, h('span', { className: 'dshmove-k' }, 'DSH 壳：'), h('span', null, inc.shell ? '包含' : '不包含')),
                h('div', null, h('span', { className: 'dshmove-k' }, 'API Key：'), h('span', null, inc.credentials ? '包含' : '不包含（需重新填写）')),
                h('div', null, h('span', { className: 'dshmove-k' }, 'zip 大小：'), h('span', null, formatBytes(preview.zipSize))),
                h('div', null, h('span', { className: 'dshmove-k' }, '包内条目：'), h('span', null, String(preview.entryCount))),
              ),
              h('div', { className: 'dshmove-k dshmove-k-top' }, '工程：'),
              Array.isArray(inc.projects) && inc.projects.length > 0
                ? h('div', { className: 'dshmove-list' },
                    inc.projects.map((p) => h('div', { key: p, className: 'dshmove-row-label', title: p }, '• ' + p)))
                : h('div', { className: 'dshmove-muted' }, '无'),
            )
          : null,

        preview
          ? h('div', { className: 'dshmove-group' },
              h('div', { className: 'dshmove-group-title' }, '2. 还原目标（可修改，默认按包内记录与本机）'),
              h('label', { className: 'dshmove-field' },
                h('span', { className: 'dshmove-field-label' }, '对话历史目录（.dsh）'),
                h('div', { className: 'dshmove-row' },
                  h('input', { className: 'dshmove-input', value: home, onChange: (e) => setHome(e.target.value), placeholder: '%USERPROFILE%\\.dsh' }),
                  h('button', { type: 'button', className: 'dshmove-btn', onClick: () => pickInto(setHome), disabled: !workspaces }, '选择目录'),
                ),
              ),
              h('label', { className: 'dshmove-field' },
                h('span', { className: 'dshmove-field-label' }, '工程还原根目录'),
                h('div', { className: 'dshmove-row' },
                  h('input', { className: 'dshmove-input', value: projectsRoot, onChange: (e) => setProjectsRoot(e.target.value), placeholder: '默认：包内第一个工程的上级目录' }),
                  h('button', { type: 'button', className: 'dshmove-btn', onClick: () => pickInto(setProjectsRoot), disabled: !workspaces }, '选择目录'),
                ),
              ),
              h('label', { className: 'dshmove-field' },
                h('span', { className: 'dshmove-field-label' }, 'npm 全局目录（装 DSH 壳）'),
                h('div', { className: 'dshmove-row' },
                  h('input', { className: 'dshmove-input', value: npm, onChange: (e) => setNpm(e.target.value), placeholder: '%APPDATA%\\npm' }),
                  h('button', { type: 'button', className: 'dshmove-btn', onClick: () => pickInto(setNpm), disabled: !workspaces }, '选择目录'),
                ),
              ),
              h('div', { className: 'dshmove-warn' }, '还原会覆盖目标目录中的同名文件。API key 不会随包携带，需在新电脑重新填写；新电脑需先安装 Node.js ≥ 22。'),
              h('button', { type: 'button', className: 'dshmove-btn dshmove-primary', disabled: !!(job && job.running) || uploading, onClick: onImport }, '开始还原'),
              jobArea(job),
            )
          : null,
      )
    }

    // ------------------------------------------------------------ 公共渲染
    function jobArea(job) {
      if (!job) return null
      const kids = []
      if (job.running) kids.push(h('div', { className: 'dshmove-muted' }, '⏳ 后台执行中，请稍候…'))
      if (job.error) kids.push(h('div', { className: 'dshmove-error' }, '失败：' + job.error))
      if (job.done && job.result) {
        if (job.result.outPath) {
          const sizeTxt = job.result.sizeBytes != null ? formatBytes(job.result.sizeBytes) : '未知'
          kids.push(h('div', { className: 'dshmove-success' },
            h('div', null, '✅ 打包完成'),
            h('div', { className: 'dshmove-code' }, 'zip：' + job.result.outPath),
            h('div', null, '大小：' + sizeTxt),
            h('div', { className: 'dshmove-hint' }, '可用命令验证：node dsh-move.mjs unpack "' + job.result.outPath + '" --dry-run'),
          ))
        } else if (job.result.done) {
          kids.push(h('div', { className: 'dshmove-success' }, '✅ 还原完成（详见下方日志）'))
        }
      }
      if (job.log && job.log.length > 0) kids.push(h('pre', { className: 'dshmove-log' }, job.log))
      return h('div', { className: 'dshmove-job' }, ...kids)
    }

    // ------------------------------------------------------------ 工具函数
    function bytesToBase64(bytes) {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
      let out = ''
      let i = 0
      const len = bytes.length
      while (i < len) {
        const b0 = bytes[i]
        const b1 = i + 1 < len ? bytes[i + 1] : -1
        const b2 = i + 2 < len ? bytes[i + 2] : -1
        out += chars[b0 >> 2]
        out += chars[((b0 & 3) << 4) | (b1 < 0 ? 0 : b1 >> 4)]
        if (b1 < 0) {
          out += '=='
        } else {
          out += chars[((b1 & 15) << 2) | (b2 < 0 ? 0 : b2 >> 6)]
          out += b2 < 0 ? '=' : chars[b2 & 63]
        }
        i += 3
      }
      return out
    }

    function formatBytes(n) {
      if (n == null || !Number.isFinite(n)) return '未知'
      if (n >= 1e9) return (n / 1e9).toFixed(2) + ' GB'
      if (n >= 1e6) return (n / 1e6).toFixed(1) + ' MB'
      return Math.max(1, Math.round(n / 1e3)) + ' KB'
    }

    function stamp() {
      const d = new Date()
      const p = (x) => String(x).padStart(2, '0')
      return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes())
    }

    function parentOf(p) {
      if (!p || typeof p !== 'string') return ''
      const s = p.replace(/[\\/]+$/, '')
      const i = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'))
      return i > 0 ? s.slice(0, i) : s
    }

    // ------------------------------------------------------------ 样式（前缀 dshmove- 防冲突）
    const CSS =
      '.dshmove-root{display:flex;flex-direction:column;gap:12px;width:100%;padding:6px 2px 16px;font-size:13px;line-height:1.6;color:var(--dsw-alias-label-primary,#1f2329);box-sizing:border-box}' +
      '.dshmove-root *{box-sizing:border-box}' +
      '.dshmove-head{display:flex;flex-direction:column;gap:2px}' +
      '.dshmove-title{font-size:16px;font-weight:600}' +
      '.dshmove-sub{font-size:12px;color:var(--dsw-alias-label-secondary,#8a919f)}' +
      '.dshmove-tabs{display:flex;gap:8px;border-bottom:1px solid var(--dsw-alias-divider,#e5e6eb);padding-bottom:8px}' +
      '.dshmove-tabs-sm{padding-bottom:0;border-bottom:none}' +
      '.dshmove-tab{cursor:pointer;border:none;background:none;font:inherit;color:var(--dsw-alias-label-secondary,#8a919f);padding:6px 14px;border-radius:8px;font-weight:500}' +
      '.dshmove-tab:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}' +
      '.dshmove-tab-active{background:var(--dsw-specific-sidebar-nav-item-active,rgba(0,0,0,.06));color:var(--dsw-alias-label-primary,#1f2329)}' +
      '.dshmove-panel{display:flex;flex-direction:column;gap:14px}' +
      '.dshmove-form{display:flex;flex-direction:column;gap:14px}' +
      '.dshmove-group{display:flex;flex-direction:column;gap:6px}' +
      '.dshmove-group-head{display:flex;align-items:center;gap:8px}' +
      '.dshmove-group-title{font-weight:600;font-size:13px}' +
      '.dshmove-link{cursor:pointer;border:none;background:none;color:var(--dsw-alias-brand-primary,#4c6ef5);font:inherit;font-size:12px;padding:0 2px}' +
      '.dshmove-link:hover{text-decoration:underline}' +
      '.dshmove-list{display:flex;flex-direction:column;gap:2px;max-height:220px;overflow-y:auto;border:1px solid var(--dsw-alias-divider,#e5e6eb);border-radius:8px;padding:4px}' +
      '.dshmove-row{display:flex;align-items:flex-start;gap:8px;cursor:pointer;padding:4px 6px;border-radius:6px}' +
      '.dshmove-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.04))}' +
      '.dshmove-row input[type=checkbox]{margin-top:3px}' +
      '.dshmove-row-label{word-break:break-all;min-width:0}' +
      '.dshmove-sess-title{display:block;font-weight:500;font-size:12px}' +
      '.dshmove-sess-sub{display:block;font-size:11px;color:var(--dsw-alias-label-secondary,#8a919f);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:480px}' +
      '.dshmove-input{flex:1;min-width:0;padding:6px 10px;border:1px solid var(--dsw-alias-divider,#d0d3d9);border-radius:8px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1f2329);font:inherit;font-size:12px}' +
      '.dshmove-file-input{position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;clip:rect(0 0 0 0);border:0;padding:0;margin:-1px}' +
      '.dshmove-uploader{display:flex;flex-direction:column;gap:10px}' +
      '.dshmove-dropzone{position:relative;display:flex;align-items:center;justify-content:center;min-height:104px;padding:18px 16px;border:1.5px dashed var(--dsw-alias-divider,#d0d3d9);border-radius:16px;cursor:pointer;text-align:center;background:transparent;transition:border-color .15s ease,background-color .15s ease}' +
      '.dshmove-dropzone:hover,.dshmove-dropzone:focus-visible{border-color:var(--dsw-alias-brand-primary,#4c6ef5);background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4c6ef5) 5%,transparent);outline:none}' +
      '.dshmove-dropzone-drag{border-color:var(--dsw-alias-brand-primary,#4c6ef5);background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4c6ef5) 10%,transparent)}' +
      '.dshmove-dropzone-empty{display:flex;flex-direction:column;align-items:center;gap:4px}' +
      '.dshmove-dropzone-icon{font-size:24px;line-height:1;opacity:.75;margin-bottom:2px}' +
      '.dshmove-dropzone-title{font-size:13px;font-weight:600}' +
      '.dshmove-dropzone-sub{font-size:11px;color:var(--dsw-alias-label-secondary,#8a919f)}' +
      '.dshmove-file-chip{display:flex;align-items:center;gap:8px;max-width:100%;min-width:0;padding:8px 12px;border:1px solid var(--dsw-alias-divider,#e5e6eb);border-radius:10px;background:var(--dsw-alias-bg-layer-1,#f7f8fa)}' +
      '.dshmove-file-chip-icon{font-size:14px;line-height:1;flex:none}' +
      '.dshmove-file-chip-name{font-size:12px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}' +
      '.dshmove-file-chip-size{font-size:11px;color:var(--dsw-alias-label-secondary,#8a919f);flex:none}' +
      '.dshmove-file-chip-x{cursor:pointer;border:none;background:none;color:var(--dsw-alias-label-secondary,#8a919f);font-size:14px;line-height:1;padding:2px 5px;border-radius:6px;flex:none;transition:color .15s ease,background-color .15s ease}' +
      '.dshmove-file-chip-x:hover{color:var(--dsw-alias-state-error-primary,#d92d20);background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d92d20) 10%,transparent)}' +
      '.dshmove-row-end{justify-content:flex-end}' +
      '.dshmove-btn{cursor:pointer;padding:6px 14px;border:1px solid var(--dsw-alias-divider,#d0d3d9);border-radius:8px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1f2329);font:inherit;font-size:12px;flex:none}' +
      '.dshmove-btn:disabled{opacity:.5;cursor:not-allowed}' +
      '.dshmove-primary{background:var(--dsw-alias-brand-primary,#4c6ef5);border-color:transparent;color:#fff}' +
      '.dshmove-primary:disabled{background:var(--dsw-alias-brand-primary,#4c6ef5)}' +
      '.dshmove-hint{font-size:12px;color:var(--dsw-alias-label-secondary,#8a919f)}' +
      '.dshmove-warn{font-size:12px;color:var(--dsw-alias-state-warning,#b25e09)}' +
      '.dshmove-error{font-size:12px;color:var(--dsw-alias-state-error-primary,#d92d20);background:rgba(217,45,32,.06);border-radius:8px;padding:8px 10px}' +
      '.dshmove-success{font-size:13px;color:var(--dsw-alias-state-success,#1f9d55);background:rgba(31,157,85,.07);border-radius:8px;padding:10px 12px;display:flex;flex-direction:column;gap:2px}' +
      '.dshmove-code{font-family:ui-monospace,Consolas,monospace;font-size:12px;color:var(--dsw-alias-label-primary,#1f2329);word-break:break-all}' +
      '.dshmove-log{max-height:200px;overflow:auto;background:var(--dsw-alias-bg-layer-1,#f7f8fa);border:1px solid var(--dsw-alias-divider,#e5e6eb);border-radius:8px;padding:8px 10px;font-family:ui-monospace,Consolas,monospace;font-size:11px;white-space:pre-wrap;word-break:break-all;margin:0}' +
      '.dshmove-muted{font-size:12px;color:var(--dsw-alias-label-secondary,#8a919f)}' +
      '.dshmove-card{display:flex;flex-direction:column;gap:6px;border:1px solid var(--dsw-alias-divider,#e5e6eb);border-radius:10px;padding:12px}' +
      '.dshmove-card-title{font-weight:600}' +
      '.dshmove-kv{display:flex;flex-direction:column;gap:2px;font-size:12px}' +
      '.dshmove-k{font-weight:500;font-size:12px}' +
      '.dshmove-k-top{margin-top:4px}' +
      '.dshmove-field{display:flex;flex-direction:column;gap:4px}' +
      '.dshmove-field-label{font-size:12px;color:var(--dsw-alias-label-secondary,#8a919f)}' +
      '.dshmove-progress{height:6px;background:var(--dsw-alias-divider,#e5e6eb);border-radius:3px;overflow:hidden}' +
      '.dshmove-progress-fill{height:100%;background:var(--dsw-alias-brand-primary,#4c6ef5);transition:width .2s}' +
      '.dshmove-job{display:flex;flex-direction:column;gap:6px}'

    // ------------------------------------------------------------ 插件入口
    const apply = (ctx) => {
      clientCtx = ctx
      const slots = ctx.get('slots')
      if (!slots) return
      slots.inject('settings.section', () => slots.register(
        { name: 'settings.section', id: 'dsh-move', order: 30, label: () => '搬家' },
        () => h(DshMoveSection, null),
      ))
    }
    const inject = ['slots']

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
