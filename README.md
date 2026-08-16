# dsh-move —— 设置栏搬家插件

在 DSH 设置栏提供「搬家」页面（挂在 `settings.section`）：

- **打包**：勾选工程目录（必选，≥1 个）+ 会话（可选，默认全选、可全不选）→ 生成 zip（调用 `dsh-move.mjs pack`）
- **导入**：选 zip（文件上传或直接输入路径）→ 预览包内容 → 指定还原目标 → 还原（调用 `dsh-move.mjs unpack`）

## 依赖

- 引擎 `dsh-move.mjs`（含 `pack`/`unpack`，Windows bsdtar 打包）
  - 定位顺序：`$env:DSH_MOVE_DIR\dsh-move.mjs` → `<dsh 进程 cwd>\dsh-move\dsh-move.mjs` → `D:\Deepseek Harness\engineer\dsh-move\dsh-move.mjs`
- 引擎需支持 `--no-auto-projects` / `--sessions` 两个扩展 flag（见引擎仓库的 dsh-move.mjs）

## 结构

```
lib/index.js    host 半区：/dsh-move/* 同源 HTTP 路由（webServer），spawn 引擎执行打包/还原
lib/client.js   client 半区：settings.section「搬家」UI（纯 JS，免构建）
cordis.patch.yml  插入 host 组合行
```

## 说明

- 上传的 zip 分片暂存于 `~/.dsh/dsh-move/tmp`（下次上传/插件卸载时清理）
- API key（`.credentials.yaml`）默认不打包；新电脑还原后需重填
