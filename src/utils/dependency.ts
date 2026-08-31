import { gte } from 'semver'
import { STATIC_IMPORTS } from './static-imports'
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
 * 生成 REPL 沙箱的 import map。
 *
 * antdv-next 生态全部走 jsdelivr 原始未打包 dist（不经 esm.sh / +esm 二次打包），
 * 并统一经 import map 解析 `vue`，保证沙箱内只有一个 vue 实例、antdv-next 的
 * config-provider / theme 模块只有一个 Symbol——主题与配置在用户代码、pro、
 * x 组件之间完全共享（见 static-imports.ts 的枚举说明）。
 *
 * 已知限制：
 * - antdv-next 的依赖版本（@v-c/* 等）按 antdv-next@1.5.3 锁定；切换其他
 *   antdvNext 版本时依赖版本不随动，个别 API 可能不兼容。
 * - antdv-next 仅显式列出常用子路径；未列出的子路径导入（如
 *   `antdv-next/theme`）不支持。
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
    ...STATIC_IMPORTS,
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
    // x 的 browser 单文件 bundle(内部仅依赖 vue,经 import map 与 antdv-next 共享)
    Object.assign(imports, {
      '@antdv-next/x': genCdnLink(
        '@antdv-next/x',
        x,
        '/es/antdv-next-x.esm.js',
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
      // x-markdown 的外部依赖(external 未打包,需 import map 解析)
      dompurify:
        'https://cdn.jsdelivr.net/npm/dompurify@3.1.0/dist/purify.es.mjs',
      marked: 'https://cdn.jsdelivr.net/npm/marked@12.0.0/+esm',
      katex: 'https://cdn.jsdelivr.net/npm/katex@0.16.25/+esm',
      // Latex 插件的裸 css import:浏览器无法 ESM 加载 css,
      // 映射为空模块占位,katex 样式由用户按需引入(如 <link> 或 index.html)
      'katex/dist/katex.min.css': 'data:text/javascript,export default {}',
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
