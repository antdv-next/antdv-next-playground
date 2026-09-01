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

### URL Parameters (Pro / X)

Pro and X are **off by default** — their dependencies are not imported into the sandbox. Enable them via the Settings dialog, or via URL parameters so docs/demo pages can deep-link:

- `?pro=1` — enable Pro (`@antdv-next/pro`)
- `?x=1` — enable X (`@antdv-next/x`)
- `?pro=1&x=1` — enable both
- `0` / `false` / `no` / `off` explicitly disable (e.g. `?x=0`)

The parameters are preserved across reloads. Once a feature is toggled in the UI, the choice is saved into the shareable URL and takes precedence over the parameter.

### Antdv Next >= 1.0.4

The antdv-next version selector is restricted to **>= 1.0.4**.

Reason: npm packages for versions 1.0.0 ~ 1.0.3 do not include `dist/antd.esm.js` (different early build structure, using `dist/index.js` instead). The Playground relies on this ESM bundle to run in the browser, so older versions will result in a 404.

## Credits

- [vuejs/repl](https://github.com/vuejs/repl)

## License

[MIT](./LICENSE)
