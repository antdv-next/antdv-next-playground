import { gte } from 'semver'
import { ESM_IMPORTS, STATIC_IMPORTS } from './static-imports'
import type { Versions } from '@/composables/store'
import type { ImportMap } from '@vue/repl'
import type { MaybeRef } from '@vueuse/core'
import type { Ref } from 'vue'

export interface Dependency {
  pkg?: string
  version?: string
  path: string
}

export type Cdn = 'unpkg' | 'jsdelivr' | 'jsdelivr-fastly'
export const cdn = useLocalStorage<Cdn>('setting-cdn', 'jsdelivr')

const STATIC_CDN_HOST: Record<Cdn, string> = {
  jsdelivr: 'cdn.jsdelivr.net',
  'jsdelivr-fastly': 'fastly.jsdelivr.net',
  unpkg: 'unpkg.com',
}

export const genCdnLink = (
  pkg: string,
  version: string | undefined,
  path: string,
) => {
  version = version ? `@${version}` : ''
  switch (cdn.value) {
    case 'jsdelivr':
      return `https://cdn.jsdelivr.net/npm/${pkg}${version}${path}`
    case 'jsdelivr-fastly':
      return `https://fastly.jsdelivr.net/npm/${pkg}${version}${path}`
    case 'unpkg':
      return `https://unpkg.com/${pkg}${version}${path}`
  }
}

export const genCompilerSfcLink = (version: string) => {
  return genCdnLink(
    '@vue/compiler-sfc',
    version,
    '/dist/compiler-sfc.esm-browser.js',
  )
}

export const getExtraPackages = () => {
  return new URLSearchParams(location.search).get('extra_packages')
}

/**
 * 静态依赖树(static-imports.ts)按当前 CDN 设置拼 URL。
 * +esm 条目只有 jsdelivr/fastly 支持;CDN 切到 unpkg 时退化为 esm.sh 转换
 * (仅 dayjs/@ant-design/colors/@ant-design/fast-color 等无 vue 依赖的叶包)。
 */
// /dayjs@1.11.23/plugin/advancedFormat/+esm -> pkg/ver/subpath
const ESM_SPEC_RE = /^\/((?:@[^/]+\/)?[^@/]+)@([^/]+)(\/[^+]*)?\/\+esm$/
const genStaticCdnImports = (): Record<string, string> => {
  const host = STATIC_CDN_HOST[cdn.value]
  const out: Record<string, string> = {}
  for (const [spec, path] of Object.entries(STATIC_IMPORTS)) {
    if (cdn.value === 'unpkg' && ESM_IMPORTS.includes(spec)) {
      const m = ESM_SPEC_RE.exec(path)
      if (m) {
        out[spec] = `https://esm.sh/${m[1]}@${m[2]}${m[3] ?? ''}`
        continue
      }
      console.warn(`[playground] unpkg 无法服务 ${spec}(${path}),已跳过`)
      continue
    }
    const prefix = cdn.value === 'unpkg' ? '' : '/npm'
    out[spec] = `https://${host}${prefix}${path}`
  }
  return out
}

/**
 * 生成 REPL 沙箱的 import map。
 *
 * antdv-next 生态全部走 CDN 原始 ESM 产物(不经 esm.sh / +esm 二次打包),
 * 并统一经 import map 解析 `vue`,保证沙箱内只有一个 vue 实例、antdv-next 的
 * config-provider / theme 模块只有一个 Symbol——主题与配置在用户代码、pro、
 * x 组件之间完全共享(依赖树与原始 ESM 解析见 static-imports.ts 的枚举说明)。
 *
 * 静态依赖树与 x 依赖均跟随 `cdn` 设置切换 jsdelivr / fastly / unpkg;
 * +esm 条目(ESM_IMPORTS:dayjs、@ant-design/colors 等)在 unpkg 下退化为
 * esm.sh 转换(jsdelivr/fastly 走原生 +esm)。
 *
 * 已知限制:
 * - 静态依赖树(static-imports.ts)由 pnpm gen:imports 按生成时的 antdv-next latest
 *   解析;在界面上切换到其他 antdvNext 版本时,@v-c/* 等依赖版本不随动,个别 API
 *   可能不兼容(import map 只能映射一份依赖树)。
 * - 仅覆盖 antdv-next 运行时可达的裸导入;未映射的子路径导入(如
 *   `antdv-next/locale/fr_FR`)不支持。locale 对象只能由已映射的
 *   @v-c/pagination/locale、@v-c/picker/locale 的 en_US/zh_CN 拼装。
 * - x-markdown 的 marked/katex/dompurify 版本为手动固定,需随 x-markdown 发版手动更新。
 */
export const genImportMap = ({
  vue,
  antdvNext,
  pro,
  x,
}: Partial<Versions> = {}): ImportMap => {
  const imports: Record<string, string> = {
    vue: genCdnLink(
      '@vue/runtime-dom',
      vue,
      '/dist/runtime-dom.esm-browser.js',
    ),
    '@vue/shared': genCdnLink(
      '@vue/shared',
      vue,
      '/dist/shared.esm-bundler.js',
    ),
    'antdv-next': genCdnLink('antdv-next', antdvNext, '/dist/index.js'),
    'antdv-next/config-provider': genCdnLink(
      'antdv-next',
      antdvNext,
      '/dist/config-provider/index.js',
    ),
    'antdv-next/config-provider/context': genCdnLink(
      'antdv-next',
      antdvNext,
      '/dist/config-provider/context.js',
    ),
    'antdv-next/config-provider/hooks/useCSSVarCls': genCdnLink(
      'antdv-next',
      antdvNext,
      '/dist/config-provider/hooks/useCSSVarCls.js',
    ),
    'antdv-next/theme/internal': genCdnLink(
      'antdv-next',
      antdvNext,
      '/dist/theme/internal.js',
    ),
    'antdv-next/global.d.ts': genCdnLink(
      'antdv-next',
      antdvNext,
      '/global.d.ts',
    ),
    ...genStaticCdnImports(),
  }

  if (pro) {
    Object.assign(imports, {
      '@antdv-next/pro': genCdnLink('@antdv-next/pro', pro, '/dist/index.js'),
      '@antdv-next/pro/scrollbar': genCdnLink(
        '@antdv-next/pro',
        pro,
        '/dist/scrollbar/index.js',
      ),
    })
  }
  if (x) {
    // x 改用 dist 模块构建:内部以裸导入引用 antdv-next / @antdv-next/cssinjs 等,
    // 全部经 import map 与用户代码共享同一实例——config-provider 的主题(dark 模式/
    // 主色)在 x 组件上同样生效。es/antdv-next-x.esm.js 是内置 antdv-next 的单文件
    // bundle,其 config-provider context 与外部不共享,主题不会联动,故不再使用。
    Object.assign(imports, {
      '@antdv-next/x': genCdnLink('@antdv-next/x', x, '/dist/index.js'),
      // x 的 theme/useToken 直接复用 antdv-next 内部模块(同源共享 context)
      'antdv-next/dist/theme/useToken': genCdnLink(
        'antdv-next',
        antdvNext,
        '/dist/theme/useToken.js',
      ),
      // x 生态子包(独立发版,版本固定当前 latest)
      '@antdv-next/x-markdown': genCdnLink(
        '@antdv-next/x-markdown',
        '0.1.4',
        '/dist/index.js',
      ),
      '@antdv-next/x-markdown/plugins/Latex': genCdnLink(
        '@antdv-next/x-markdown',
        '0.1.4',
        '/plugins/Latex/index.js',
      ),
      '@antdv-next/x-card': genCdnLink(
        '@antdv-next/x-card',
        '0.0.1',
        '/dist/index.js',
      ),
      // x-markdown 的外部依赖(external 未打包,需 import map 解析;均用各自 ESM 构建)
      dompurify: genCdnLink('dompurify', '3.1.0', '/dist/purify.es.mjs'),
      marked: genCdnLink('marked', '12.0.0', '/lib/marked.esm.js'),
      katex: genCdnLink('katex', '0.16.25', '/dist/katex.mjs'),
      // Latex 插件的裸 css import:浏览器无法 ESM 加载 css,
      // 映射为空模块占位,katex 样式由用户按需引入(如 <link> 或 index.html)
      'katex/dist/katex.min.css': 'data:text/javascript,export default {}',
      // mermaid(XMermaid 懒加载):esm.sh 构建,整个依赖树(roughjs/cytoscape/
      // dagre-d3-es 等)重写为自包含 URL,无需逐个映射
      'mermaid/dist/': 'https://esm.sh/mermaid@11.12.1/dist/',
      // prosemirror(XSender 富文本):esm.sh 构建,依赖树自包含
      'prosemirror-model': 'https://esm.sh/prosemirror-model@1.25.11',
      'prosemirror-state': 'https://esm.sh/prosemirror-state@1.4.4',
      'prosemirror-view': 'https://esm.sh/prosemirror-view@1.42.3',
      'prosemirror-commands': 'https://esm.sh/prosemirror-commands@1.7.2',
      'prosemirror-history': 'https://esm.sh/prosemirror-history@1.5.0',
      'prosemirror-keymap': 'https://esm.sh/prosemirror-keymap@1.2.3',
      // shiki(XCodeHighlighter):core/引擎走 esm.sh(依赖树自包含);
      // 主题与内置语言是纯数据文件,直指 @shikijs 包内产物(随 cdn 设置切换)
      'shiki/core': 'https://esm.sh/shiki@3.13.0/core',
      'shiki/engine/javascript':
        'https://esm.sh/shiki@3.13.0/engine/javascript',
      'shiki/dist/themes/vitesse-dark.mjs': genCdnLink(
        '@shikijs/themes',
        '3.13.0',
        '/dist/vitesse-dark.mjs',
      ),
      'shiki/dist/themes/vitesse-light.mjs': genCdnLink(
        '@shikijs/themes',
        '3.13.0',
        '/dist/vitesse-light.mjs',
      ),
      'shiki/dist/langs/typescript.mjs': genCdnLink(
        '@shikijs/langs',
        '3.13.0',
        '/dist/typescript.mjs',
      ),
      'shiki/dist/langs/javascript.mjs': genCdnLink(
        '@shikijs/langs',
        '3.13.0',
        '/dist/javascript.mjs',
      ),
      'shiki/dist/langs/python.mjs': genCdnLink(
        '@shikijs/langs',
        '3.13.0',
        '/dist/python.mjs',
      ),
      'shiki/dist/langs/json.mjs': genCdnLink(
        '@shikijs/langs',
        '3.13.0',
        '/dist/json.mjs',
      ),
      'shiki/dist/langs/html.mjs': genCdnLink(
        '@shikijs/langs',
        '3.13.0',
        '/dist/html.mjs',
      ),
      'shiki/dist/langs/css.mjs': genCdnLink(
        '@shikijs/langs',
        '3.13.0',
        '/dist/css.mjs',
      ),
    })
  }

  const extraPackages = getExtraPackages()
  if (extraPackages === '@vueuse/core') {
    Object.assign(imports, {
      '@vueuse/core': genCdnLink('@vueuse/core', 'latest', '/dist/index.js'),
      '@vueuse/shared': genCdnLink(
        '@vueuse/shared',
        'latest',
        '/dist/index.js',
      ),
    })
  }

  return { imports }
}

export const getVersions = (pkg: MaybeRef<string>) => {
  const url = computed(
    () => `https://data.jsdelivr.com/v1/package/npm/${unref(pkg)}`,
  )
  return useFetch(url, {
    initialData: [],
    afterFetch: (ctx) => ((ctx.data = ctx.data.versions), ctx),
    refetch: true,
  }).json<string[]>().data as Ref<string[]>
}

export const getSupportedVueVersions = () => {
  const versions = getVersions('vue')
  return computed(() =>
    versions.value.filter((version) => gte(version, '3.5.0')),
  )
}

export const getSupportedTSVersions = () => {
  const versions = getVersions('typescript')
  return computed(() =>
    versions.value.filter(
      (version) => !version.includes('dev') && !version.includes('insiders'),
    ),
  )
}

export const getSupportedAntdvVersions = () => {
  const versions = getVersions('antdv-next')
  return computed(() =>
    // 1.0.0 ~ 1.0.3 没有 dist/antd.esm.js（早期打包结构不同）
    versions.value.filter((version) => gte(version, '1.0.4')),
  )
}

export const getSupportedProVersions = () => {
  const versions = getVersions('@antdv-next/pro')
  return computed(() =>
    // pro 需要 antdv-next >= 1.3.0，只有正式版本可用
    versions.value.filter((version) => !version.includes('-')),
  )
}

export const getSupportedXVersions = () => {
  const versions = getVersions('@antdv-next/x')
  return computed(() => versions.value)
}
