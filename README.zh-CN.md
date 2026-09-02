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

## 致谢

- [vuejs/repl](https://github.com/vuejs/repl)

## 许可证

[MIT](./LICENSE)
