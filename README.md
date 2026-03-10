<p align="center">
  <img width="300px" src="./src/assets/logo.svg">
</p>

# Antdv Next Playground

[中文](./README.zh-CN.md)

Online playground for [antdv-next](https://github.com/antdv-next/antdv-next), powered by [@vue/repl](https://github.com/vuejs/repl).

## Usage

Go to [antdv-next-playground](https://play.antdv-next.com) to have a try!

## Development

```bash
pnpm install
pnpm dev
```

## Notes

### Vue >= 3.5.0

The Vue version selector is restricted to **>= 3.5.0**.

Reason: The antdv-next dependency `@v-c/color-picker` uses `onWatcherCleanup` (a Vue 3.5+ API), which is bundled into `antdv-next/dist/antd.esm.js`. Selecting a Vue version below 3.5 will cause the preview to error:

```
Uncaught SyntaxError: The requested module 'vue' does not provide an export named 'onWatcherCleanup'
```

> antdv-next itself does not directly use this API — it is introduced by an indirect dependency. If the upstream removes this dependency, the version restriction can be relaxed.

### Antdv Next >= 1.0.4

The antdv-next version selector is restricted to **>= 1.0.4**.

Reason: npm packages for versions 1.0.0 ~ 1.0.3 do not include `dist/antd.esm.js` (different early build structure, using `dist/index.js` instead). The Playground relies on this ESM bundle to run in the browser, so older versions will result in a 404.

## Credits

- [vuejs/repl](https://github.com/vuejs/repl)

## License

[MIT](./LICENSE)
