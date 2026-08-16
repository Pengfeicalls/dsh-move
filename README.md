# dsh-move —— Harness「搬家」插件

**换电脑 / 备份 / 迁移**：把 DeepSeek Harness 的工程目录与会话打包成 zip，搬到新机器一键还原——不用重新搭建环境、不用重复交代上下文。

## 功能

| 能力 | 说明 |
|---|---|
| 📦 打包 | 设置栏「搬家」页面：勾选工程目录（必选）+ 会话（可选）→ 生成 zip 备份包 |
| 📥 导入还原 | 选择 zip（文件上传或输入路径）→ 预览包内容 → 指定还原目标 → 还原 |
| 🔒 安全默认 | API key（`.credentials.yaml`）默认不打包；新电脑还原后需重填 |
| ⚡ 断点续传 | 大 zip 分片上传，支持中止/续传 |

## 安装

```powershell
# 需要：dsh CLI（npm install -g @deepseek-ai/dsh）
dsh plugin --profile web add github:Pengfeicalls/dsh-move#v0.1.1
# 重启 Harness 生效
```

## 使用

1. 打开 设置 → 搬家；
2. **打包**：勾选要带走的工程目录和会话 → 生成 zip 下载；
3. 新机器装好插件后，**导入**：选 zip → 预览 → 还原到目标目录。

## 依赖

- 引擎 `dsh-move.mjs`（含 `pack`/`unpack`，Windows bsdtar 打包）
  - 定位顺序：`$env:DSH_MOVE_DIR\dsh-move.mjs` → `<dsh 进程 cwd>\dsh-move\dsh-move.mjs` → `D:\Deepseek Harness\engineer\dsh-move\dsh-move.mjs`
- 引擎需支持 `--no-auto-projects` / `--sessions` 两个扩展 flag（见引擎仓库的 dsh-move.mjs）

## 结构

```
lib/index.js      host 半区：/dsh-move/* 同源 HTTP 路由（webServer），spawn 引擎执行打包/还原
lib/client.js     client 半区：settings.section「搬家」UI（纯 JS，免构建）
cordis.patch.yml  插入 host 组合行
```

## 说明

- 上传的 zip 分片暂存于 `~/.dsh/dsh-move/tmp`（下次上传/插件卸载时清理）

MIT License
