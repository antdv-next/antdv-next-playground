<p align="center">
  <img width="300px" src="./src/assets/logo.svg">
</p>

# Antdv Next Playground

[English](./README.md)

基于 [@vue/repl](https://github.com/vuejs/repl) 的 [antdv-next](https://github.com/antdv-next/antdv-next) 在线演练场。

## 使用

前往 [antdv-next-playground](https://play.antdv-next.com) 在线体验！

## 开发

```bash
pnpm install
pnpm dev
```

## 注意事项

### Vue >= 3.5.0

Vue 版本选择器限制为 **>= 3.5.0**。

原因：antdv-next 的依赖 `@v-c/color-picker` 使用了 `onWatcherCleanup`（Vue 3.5 新增 API），该代码被打包进了 `antdv-next/dist/antd.esm.js`。选择低于 3.5 的 Vue 版本会导致预览报错：

```
Uncaught SyntaxError: The requested module 'vue' does not provide an export named 'onWatcherCleanup'
```

> antdv-next 自身源码没有直接使用此 API，是间接依赖引入的。如果上游移除了该依赖，可放宽版本限制。

### URL 参数（Pro / X）

Pro 和 X **默认关闭**——它们的依赖不会引入沙箱。可以通过设置对话框开启，也可以通过 URL 参数开启，方便 docs/示例页面直接深链：

- `?pro=1` — 开启 Pro（`@antdv-next/pro`）
- `?x=1` — 开启 X（`@antdv-next/x`）
- `?pro=1&x=1` — 同时开启
- `0` / `false` / `no` / `off` 显式关闭（如 `?x=0`）

参数在刷新后保留。一旦在界面上手动切换过，选择会写入可分享链接并优先于参数。

### Antdv Next >= 1.0.4

antdv-next 版本选择器限制为 **>= 1.0.4**。

原因：1.0.0 ~ 1.0.3 的 npm 包没有 `dist/antd.esm.js`（早期打包结构不同，使用的是 `dist/index.js`），Playground 依赖该 ESM 全量包在浏览器中运行，低版本会导致 404。

### Import Map 架构

沙箱通过分层 import map 解析依赖图（`src/utils/dependency.ts` 的 `genImportMap`），依赖内部的 import 写法变化（如 `@v-c/picker@1.5.0` 给 dayjs 插件导入加 `.js` 后缀）不再导致预览黑屏：

- **Tier 1 — raw dist（随 CDN 切换）**：`vue`、`antdv-next` 核心条目、`@antdv-next/icons`（故意用单文件 bundle——走 exports 主入口会逐文件请求 852 个图标）。这些条目承载用户代码、Pro、X 必须共享的单例（vue 运行时、config-provider/theme context）。
- **Tier 2 — esm.sh + `?external=`**：`@v-c/*`、`@antdv-next/cssinjs`、`@vueuse/*`。每个包登记根 + 公开/深子路径精确键；`external` 列表（全部共享单例 + 全部 Tier 2 根包 + 全部叶包）让这些包的裸导入保持原样，import map 始终是模块身份的唯一来源。Tier 2**不能**用尾斜杠前缀键：前缀映射是纯字符串替换，无法追加 `?external=`，缺 external 的构建会自带一份 vue。两个踩过的坑：包永远从自己的 external 列表剔除（否则 esm.sh 会把包内相对导入改写为自引用裸导入，import map 没有对应深键）；无后缀子路径键补 `.js` 别名防拼写漂移。
- **Tier 3 — esm.sh 前缀（叶包）**：无状态叶包（`es-toolkit`、`stylis` 等）登记根键 + 尾斜杠前缀键，任意子路径拼写由 esm.sh 运行时解析。例外：`dayjs` core 与 CJS 包 `@ant-design/colors` / `@ant-design/fast-color` 走 CDN 可切换的 `+esm`（esm.sh 的 CJS 命名导出探测对它们会丢导出）；`dayjs/plugin/`、`dayjs/locale/` 走 esm.sh 前缀（插件构建自包含，`extend` 时接收 dayjs 实例，无单例问题）。

运行时版本跟随：切换 antdv-next 版本时，`resolveAntdvDeps` 重新解析其直接依赖并覆盖 `src/utils/esm-packages.ts` 的快照版本（由 `scripts/gen-static-imports.mjs` 生成，CI 通过 `pnpm verify:imports` 校验）。

逃生舱：esm.sh 不可达时用 `?resolver=legacy`（设置对话框里也有）回退到冻结的全量枚举 map（`src/utils/static-imports.ts` + jsDelivr 原始/`+esm` 产物），行为与重构前一致。resolver 设置持久化在 localStorage；CDN 设置与之正交，仍控制 Tier 1、`+esm` 包、CSS URL 与 X 数据文件。

实例复制自查：DevTools Network 过滤 `esm.sh`——`vue`/`runtime-dom` 应只有一份，每个 `@v-c/*` URL 都应带完整 `external` 列表。若出现收窄版（如 `?external=vue`），说明有 Tier 2 根包漏出了 external 集合（重新生成 `esm-packages.ts`）。

## 致谢

- [vuejs/repl](https://github.com/vuejs/repl)

## 许可证

[MIT](./LICENSE)
