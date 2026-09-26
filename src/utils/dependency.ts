import { gte, valid } from 'semver'
import { ESM_PACKAGES, LEAF_PACKAGES, RAW_PACKAGES } from './esm-packages'
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

/**
 * 依赖图解析器模式:
 * - esmsh(默认):依赖图托管给 esm.sh,import map 只登记共享单例包与少量显式 key,
 *   叶子包子路径任意拼写(含 .js 后缀漂移)由 esm.sh 运行时解析;
 * - legacy:回退到冻结的 static-imports.ts 全量枚举 + jsdelivr 原始产物
 *   (esm.sh 不可达时的逃生舱,行为与重构前一致)。
 * URL ?resolver=esmsh|legacy 优先并持久化到 localStorage。
 */
export type Resolver = 'esmsh' | 'legacy'
export const resolver = useLocalStorage<Resolver>('setting-resolver', 'esmsh')
{
  const urlResolver = new URLSearchParams(location.search).get('resolver')
  if (urlResolver === 'esmsh' || urlResolver === 'legacy') {
    resolver.value = urlResolver
  }
}

const ESM_SH = 'https://esm.sh'

/**
 * 传给每个 esm.sh 构建的 external 集合:共享单例(vue/dayjs/antdv-next 核心)
 * + 全部 Tier2 根包 + 全部 Tier3 叶包。external 后 esm.sh 保持这些裸导入原样
 * (实测含子路径,如 dayjs/plugin/advancedFormat.js),由 import map 统一解析——
 * 跨包只有一份 vue / @antdv-next/cssinjs / @v-c/* 实例,主题与 config-provider
 * context 不分裂;同时避免 Tier2 构建内嵌 esm.sh 自己的 CJS 转换产物
 * (实测 @v-c/color-picker 内嵌的 @ant-design/fast-color 转换丢命名导出,直接炸)。
 */
const ESM_EXTERNALS_LIST = [
  ...new Set([
    'vue',
    '@vue/shared',
    'dayjs',
    'antdv-next',
    '@antdv-next/cssinjs',
    '@antdv-next/icons',
    ...Object.keys(ESM_PACKAGES),
    ...Object.keys(LEAF_PACKAGES),
  ]),
]

// 各包剔除自身后的 external 查询串(模块级缓存)
const EXTERNALS_BY_PKG = new Map<string, string>()
const externalsFor = (pkg: string) => {
  let cached = EXTERNALS_BY_PKG.get(pkg)
  if (!cached) {
    cached = ESM_EXTERNALS_LIST.filter((e) => e !== pkg).join(',')
    EXTERNALS_BY_PKG.set(pkg, cached)
  }
  return cached
}

/**
 * Tier2 包的 esm.sh URL:版本可被 resolveAntdvDeps 覆盖;子路径经 exports/文件探测运行时解析。
 * 自身必须移出 external:否则 esm.sh 会把包内相对导入改写为自引用裸导入
 * (如 @antdv-next/cssinjs/dist/transformers/autoPrefix),import map 并无这些深键,
 * 模块图解析直接失败(实测 cssinjs 根构建复现)。
 */
const genEsmShLink = (pkg: string, version: string, subpath = '') =>
  `${ESM_SH}/${pkg}@${version}${subpath}?external=${externalsFor(pkg)}`

/** esm.sh 命名导出探测不足的 CJS 叶包(实测),走 +esm 而非 esm.sh */
const CJS_LEAF_PACKAGES = new Set([
  '@ant-design/colors',
  '@ant-design/fast-color',
])

/** CJS 包的 +esm URL:jsdelivr/fastly 走原生 +esm;unpkg 不支持,退化 esm.sh 根 URL */
const genPlusEsmLink = (pkg: string, version: string) =>
  cdn.value === 'unpkg'
    ? `${ESM_SH}/${pkg}@${version}`
    : `https://${STATIC_CDN_HOST[cdn.value]}/npm/${pkg}@${version}/+esm`

export type Cdn =
  | 'unpkg'
  | 'jsdelivr'
  | 'jsdelivr-fastly'
  | 'jsdelivr-jsdmirror'
  | 'jsdelivr-gcore'
export const cdn = useLocalStorage<Cdn>('setting-cdn', 'jsdelivr-jsdmirror')

const STATIC_CDN_HOST: Record<Cdn, string> = {
  jsdelivr: 'cdn.jsdelivr.net',
  'jsdelivr-fastly': 'fastly.jsdelivr.net',
  'jsdelivr-jsdmirror': 'cdn.jsdmirror.com',
  'jsdelivr-gcore': 'gcore.jsdelivr.net',
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
    case 'jsdelivr-jsdmirror':
      return `https://cdn.jsdmirror.com/npm/${pkg}${version}${path}`
    case 'jsdelivr-gcore':
      return `https://gcore.jsdelivr.net/npm/${pkg}${version}${path}`
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
 * (仅 legacy 模式)冻结静态依赖树(static-imports.ts)按当前 CDN 设置拼 URL,
 * 并可按所选 antdv-next 版本覆盖其直接依赖(见 resolveAntdvDeps)的版本号。
 * +esm 条目只有 jsdelivr/fastly 支持;CDN 切到 unpkg 时退化为 esm.sh 转换
 * (仅 dayjs/@ant-design/colors/@ant-design/fast-color 等无 vue 依赖的叶包)。
 */
// /@v-c/input@1.1.1/dist/index.js 或 /@ant-design/colors@8.0.1/+esm -> root/ver/path
const STATIC_SPEC_RE = /^\/((?:@[^/]+\/)?[^@/]+)@([^/]+)(\/.*)?$/
const applyStaticOverride = (
  path: string,
  overrides: Record<string, string>,
) => {
  const m = STATIC_SPEC_RE.exec(path)
  if (!m) return path
  const version = overrides[m[1]] ?? m[2]
  return `/${m[1]}@${version}${m[3] ?? ''}`
}
const genStaticCdnImports = (
  overrides: Record<string, string> = {},
): Record<string, string> => {
  const host = STATIC_CDN_HOST[cdn.value]
  const out: Record<string, string> = {}
  for (const [spec, path] of Object.entries(STATIC_IMPORTS)) {
    const urlPath = applyStaticOverride(path, overrides)
    if (cdn.value === 'unpkg' && ESM_IMPORTS.includes(spec)) {
      const m = STATIC_SPEC_RE.exec(urlPath)
      if (m) {
        out[spec] =
          `https://esm.sh/${m[1]}@${m[2]}${(m[3] ?? '').replace(/\/\+esm$/, '')}`
        continue
      }
      console.warn(`[playground] unpkg 无法服务 ${spec}(${urlPath}),已跳过`)
      continue
    }
    const prefix = cdn.value === 'unpkg' ? '' : '/npm'
    out[spec] = `https://${host}${prefix}${urlPath}`
  }
  return out
}

// 静态树里每个根包的首条路径,用作版本变更后的存在性探测(legacy 模式)
const ROOT_STATIC_PATHS = new Map<string, string>()
for (const [, path] of Object.entries(STATIC_IMPORTS)) {
  const m = STATIC_SPEC_RE.exec(path)
  if (m && !ROOT_STATIC_PATHS.has(m[1])) ROOT_STATIC_PATHS.set(m[1], path)
}

// esmsh 模式下可被版本覆盖的根包及回退版本(清单快照)
const ESMSH_FALLBACK_VERSIONS: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(ESM_PACKAGES).map(([pkg, info]) => [pkg, info.v]),
  ),
  ...LEAF_PACKAGES,
  ...Object.fromEntries(
    Object.entries(RAW_PACKAGES).map(([pkg, info]) => [pkg, info.v]),
  ),
}

const PKG_DEPS_CACHE = new Map<string, Record<string, string>>()
const ANTDV_DEPS_CACHE = new Map<string, Record<string, string>>()
const X_DEPS_CACHE = new Map<string, Record<string, string>>()

const fetchJson = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res.json()
}

const DIST_TAG_CACHE = new Map<string, string>()

/**
 * 把 dist-tag(latest/beta 等)解析成精确版本(data.jsdelivr resolve API)。
 * jsdelivr 系 CDN 对 @latest 按路径独立缓存,会混发不同年代的文件
 * (实测 jsdmirror 的 antdv-next@latest 部分路径还是旧版,造成 named export 缺失),
 * 因此所有 URL 构建前统一经此解析;已是精确版本直接返回,解析失败回退原 tag。
 */
export const resolveDistTag = async (pkg: string, tag: string) => {
  if (!tag || valid(tag)) return tag
  const key = `${pkg}@${tag}`
  const cached = DIST_TAG_CACHE.get(key)
  if (cached) return cached
  try {
    const { version } = await fetchJson(
      `https://data.jsdelivr.com/v1/package/resolve/npm/${pkg}@${tag}`,
    )
    if (version) {
      DIST_TAG_CACHE.set(key, version)
      return version
    }
  } catch {
    // 解析失败回退原 tag
  }
  return tag
}

// extra_packages=vueuse 的 latest 同样解析为精确版本,避免 @latest 混发(见 resolveDistTag)
const vueuseLatest = ref('latest')
resolveDistTag('@vueuse/core', 'latest').then((v) => {
  vueuseLatest.value = v
})

/**
 * 解析指定包的直接依赖 range -> 精确版本(jsdelivr resolve API,取 range 内最新)。
 * 失败(网络/版本不存在)回退空表,不抛错。
 */
const resolvePackageDeps = async (pkg: string, version: string) => {
  const key = `${pkg}@${version}`
  const cached = PKG_DEPS_CACHE.get(key)
  if (cached) return cached
  if (!version || version === 'preview') return {}
  try {
    const pkgJson = await fetchJson(genCdnLink(pkg, version, '/package.json'))
    const ranges = (pkgJson.dependencies ?? {}) as Record<string, string>
    const resolved: Record<string, string> = {}
    await Promise.all(
      Object.entries(ranges).map(async ([name, range]) => {
        if (typeof range !== 'string' || !/^[\^~]?\d/.test(range)) return
        try {
          const { version: v } = await fetchJson(
            `https://data.jsdelivr.com/v1/package/resolve/npm/${name}@${range}`,
          )
          if (v) resolved[name] = v
        } catch {
          // 单个包解析失败,保留默认版本
        }
      }),
    )
    PKG_DEPS_CACHE.set(key, resolved)
    return resolved
  } catch {
    return {}
  }
}

const PROBE_CACHE = new Map<string, boolean>()

const probeUrl = async (url: string) => {
  const cached = PROBE_CACHE.get(url)
  if (cached !== undefined) return cached
  try {
    const res = await fetch(url, { method: 'HEAD' })
    PROBE_CACHE.set(url, res.ok)
    return res.ok
  } catch {
    PROBE_CACHE.set(url, false)
    return false
  }
}

/**
 * 解析 antdv-next 指定版本的直接依赖 range -> 精确版本,用于覆盖清单回退版本
 * (清单是生成时的快照,切到其他版本时 @v-c/* 等应跟随所选版本)。
 *
 * - 候选根包按 resolver 模式取:esmsh 用 esm-packages 清单,legacy 用冻结静态树
 * - 子路径条目(如 @v-c/pagination/locale/en_US)随根包版本自动一致
 * - 仅当解析版本与回退版本不同时做存在性探测,失败则保留回退版本:
 *   legacy 探测 dist 文件(子路径布局敏感);esmsh 探测 package.json
 *   (esm.sh 可服务任何已发布版本,只需验证版本存在,且走当前 cdn 镜像)
 * - 单个包解析失败或整体失败(网络/版本不存在)都回退清单版本,不阻塞
 */
export const resolveAntdvDeps = async (antdvVersion: string) => {
  const cacheKey = `${resolver.value}:${antdvVersion}`
  const cached = ANTDV_DEPS_CACHE.get(cacheKey)
  if (cached) return cached
  const resolved: Record<string, string> = {}
  const ranges = await resolvePackageDeps('antdv-next', antdvVersion)
  const fallbacks: Record<string, string> =
    resolver.value === 'legacy'
      ? Object.fromEntries(
          [...ROOT_STATIC_PATHS].map(([pkg, path]) => [
            pkg,
            STATIC_SPEC_RE.exec(path)![2],
          ]),
        )
      : ESMSH_FALLBACK_VERSIONS
  await Promise.all(
    Object.entries(ranges).map(async ([name, version]) => {
      const fallback = fallbacks[name]
      if (!fallback) return // 不在清单,无版本信息可覆盖
      if (version === fallback) {
        resolved[name] = version
        return
      }
      const ok =
        resolver.value === 'legacy'
          ? await probeUrl(
              `https://cdn.jsdelivr.net/npm${applyStaticOverride(
                ROOT_STATIC_PATHS.get(name)!,
                { [name]: version },
              )}`,
            )
          : await probeUrl(genCdnLink(name, version, '/package.json'))
      if (ok) resolved[name] = version
    }),
  )
  ANTDV_DEPS_CACHE.set(cacheKey, resolved)
  return resolved
}

/**
 * 解析 @antdv-next/x 指定版本的直接依赖(mermaid / prosemirror-* / shiki),
 * 并从 shiki 版本推导 @shikijs/themes、@shikijs/langs 的同版本数据包。
 * x-markdown / x-card 等不是 x 的依赖,不随 x 版本走。
 */
export const resolveXDeps = async (xVersion: string) => {
  const cached = X_DEPS_CACHE.get(xVersion)
  if (cached) return cached
  const deps = await resolvePackageDeps('@antdv-next/x', xVersion)
  const resolved: Record<string, string> = { ...deps }
  const shikiVer = deps.shiki
  if (shikiVer) {
    // shiki 依赖树要求 @shikijs/* 与 shiki 同版本;任一缺失则整体回退静态版本
    const ok = await Promise.all(
      ['@shikijs/themes', '@shikijs/langs'].map((name) =>
        fetchJson(
          `https://data.jsdelivr.com/v1/package/resolve/npm/${name}@${shikiVer}`,
        )
          .then(() => true)
          .catch(() => false),
      ),
    )
    if (ok.every(Boolean)) {
      resolved['@shikijs/themes'] = shikiVer
      resolved['@shikijs/langs'] = shikiVer
    } else {
      delete resolved.shiki
    }
  }
  X_DEPS_CACHE.set(xVersion, resolved)
  return resolved
}

/**
 * Tier1(两模式共用):raw dist 精确 key —— vue / antdv-next 核心。
 * 单例关键且布局稳定,直接随 CDN 设置切换 jsdelivr / fastly / unpkg。
 *
 * antdv-next 生态全部走 CDN 原始 ESM 产物(不经 esm.sh / +esm 二次打包),
 * 并统一经 import map 解析 `vue`,保证沙箱内只有一个 vue 实例、antdv-next 的
 * config-provider / theme 模块只有一个 Symbol——主题与配置在用户代码、pro、
 * x 组件之间完全共享。
 */
const genTier1Imports = ({
  vue,
  antdvNext,
}: Partial<Versions>): Record<string, string> => ({
  vue: genCdnLink('@vue/runtime-dom', vue, '/dist/runtime-dom.esm-browser.js'),
  '@vue/shared': genCdnLink('@vue/shared', vue, '/dist/shared.esm-bundler.js'),
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
  'antdv-next/global.d.ts': genCdnLink('antdv-next', antdvNext, '/global.d.ts'),
})

/**
 * pro / x / extra_packages 条目(两模式共用)。
 * x 改用 dist 模块构建:内部以裸导入引用 antdv-next / @antdv-next/cssinjs 等,
 * 全部经 import map 与用户代码共享同一实例——config-provider 的主题(dark 模式/
 * 主色)在 x 组件上同样生效。es/antdv-next-x.esm.js 是内置 antdv-next 的单文件
 * bundle,其 config-provider context 与外部不共享,主题不会联动,故不再使用。
 * 版本模板:直接依赖随所选 x 版本解析(resolveXDeps),缺失时回退固定版本。
 */
const applyProXImports = (
  imports: Record<string, string>,
  { antdvNext, pro, x }: Partial<Versions>,
  xdeps: Record<string, string>,
) => {
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
    const shikiVer = xdeps.shiki ?? '3.13.0'
    const shikiThemesVer = xdeps['@shikijs/themes'] ?? shikiVer
    const shikiLangsVer = xdeps['@shikijs/langs'] ?? shikiVer
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
      // dagre-d3-es 等)重写为自包含 URL,无需逐个映射;版本随所选 x 版本解析
      'mermaid/dist/': `https://esm.sh/mermaid@${xdeps.mermaid ?? '11.12.1'}/dist/`,
      // prosemirror(XSender 富文本):esm.sh 构建,依赖树自包含;版本随所选 x 版本解析
      'prosemirror-model': `https://esm.sh/prosemirror-model@${xdeps['prosemirror-model'] ?? '1.25.11'}`,
      'prosemirror-state': `https://esm.sh/prosemirror-state@${xdeps['prosemirror-state'] ?? '1.4.4'}`,
      'prosemirror-view': `https://esm.sh/prosemirror-view@${xdeps['prosemirror-view'] ?? '1.42.3'}`,
      'prosemirror-commands': `https://esm.sh/prosemirror-commands@${xdeps['prosemirror-commands'] ?? '1.7.2'}`,
      'prosemirror-history': `https://esm.sh/prosemirror-history@${xdeps['prosemirror-history'] ?? '1.5.0'}`,
      'prosemirror-keymap': `https://esm.sh/prosemirror-keymap@${xdeps['prosemirror-keymap'] ?? '1.2.3'}`,
      // shiki(XCodeHighlighter):core/引擎走 esm.sh(依赖树自包含);
      // 主题与内置语言是纯数据文件,直指 @shikijs 包内产物(随 cdn 设置切换);
      // shiki 与 @shikijs/* 版本随所选 x 版本解析,且保持同版本号
      'shiki/core': `https://esm.sh/shiki@${shikiVer}/core`,
      'shiki/engine/javascript': `https://esm.sh/shiki@${shikiVer}/engine/javascript`,
      'shiki/dist/themes/vitesse-dark.mjs': genCdnLink(
        '@shikijs/themes',
        shikiThemesVer,
        '/dist/vitesse-dark.mjs',
      ),
      'shiki/dist/themes/vitesse-light.mjs': genCdnLink(
        '@shikijs/themes',
        shikiThemesVer,
        '/dist/vitesse-light.mjs',
      ),
      'shiki/dist/langs/typescript.mjs': genCdnLink(
        '@shikijs/langs',
        shikiLangsVer,
        '/dist/typescript.mjs',
      ),
      'shiki/dist/langs/javascript.mjs': genCdnLink(
        '@shikijs/langs',
        shikiLangsVer,
        '/dist/javascript.mjs',
      ),
      'shiki/dist/langs/python.mjs': genCdnLink(
        '@shikijs/langs',
        shikiLangsVer,
        '/dist/python.mjs',
      ),
      'shiki/dist/langs/json.mjs': genCdnLink(
        '@shikijs/langs',
        shikiLangsVer,
        '/dist/json.mjs',
      ),
      'shiki/dist/langs/html.mjs': genCdnLink(
        '@shikijs/langs',
        shikiLangsVer,
        '/dist/html.mjs',
      ),
      'shiki/dist/langs/css.mjs': genCdnLink(
        '@shikijs/langs',
        shikiLangsVer,
        '/dist/css.mjs',
      ),
    })
  }

  const extraPackages = getExtraPackages()
  // esmsh 模式下 @vueuse/* 已在 Tier2 常驻(版本跟随 antdv 依赖树),无需 latest 覆盖
  if (extraPackages === '@vueuse/core' && resolver.value === 'legacy') {
    Object.assign(imports, {
      '@vueuse/core': genCdnLink(
        '@vueuse/core',
        vueuseLatest.value,
        '/dist/index.js',
      ),
      '@vueuse/shared': genCdnLink(
        '@vueuse/shared',
        vueuseLatest.value,
        '/dist/index.js',
      ),
    })
  }
}

/**
 * 生成 REPL 沙箱的 import map(按 resolver 模式分派,见文件顶部 resolver 说明)。
 */
export const genImportMap = (
  versions: Partial<Versions> = {},
  deps: Record<string, string> = {},
  xdeps: Record<string, string> = {},
): ImportMap =>
  resolver.value === 'legacy'
    ? genLegacyImportMap(versions, deps, xdeps)
    : genEsmShImportMap(versions, deps, xdeps)

/**
 * 两模式全部托管 key 的并集。store 的去残留 watch 以此为初始对比基准:
 * 跨模式分享链接(resolver 切换前序列化)里的旧模式 key 也能被识别为托管键并清掉。
 */
export const getManagedImportKeys = () => {
  const keys = new Set<string>()
  for (const map of [
    genLegacyImportMap({ pro: 'latest', x: 'latest' }, {}, {}),
    genEsmShImportMap({ pro: 'latest', x: 'latest' }, {}, {}),
  ]) {
    for (const key of Object.keys(map.imports ?? {})) keys.add(key)
  }
  return keys
}

/**
 * esm.sh 模式(默认):
 *
 * - Tier1:vue / antdv-next 核心 raw dist 精确 key(随 CDN 切换);
 * - Tier1 补充:@antdv-next/icons raw 单文件 bundle(esm.sh 会走 exports 主入口
 *   逐文件请求 852 个图标,不可搬);
 * - Tier2(ESM_PACKAGES):@v-c/*、cssinjs、@vueuse/* 等会引用共享单例的包,
 *   根 + 公开子路径精确 key,值带 ?external= 保持裸导入由本 map 接管(不能改用
 *   尾斜杠前缀:前缀映射是纯字符串替换,无法追加 ?external=,缺 external 的
 *   esm.sh 构建会把 vue 打包进去,单例被破坏);无后缀子路径补 .js 别名防拼写漂移;
 * - Tier3(LEAF_PACKAGES):不引用共享单例的叶子包,根 + 尾斜杠前缀两条 key,
 *   任意子路径拼写由 esm.sh 运行时解析(dayjs/plugin/*.js 事故类问题免疫);
 *   例外:CJS 叶包(CJS_LEAF_PACKAGES,esm.sh 命名导出探测不足)走 CDN 可切换 +esm;
 * - dayjs:core 保持 CDN 可切换(+esm;unpkg 退化 esm.sh 根 URL),
 *   plugin/locale 走 esm.sh 前缀(插件构建自包含,extend 时接收实例,无单例问题);
 * - 版本跟随:resolveAntdvDeps 解析所选 antdv-next 版本的直接依赖并覆盖回退版本。
 *
 * 已知限制:
 * - 覆盖仅针对清单中已存在的根包;antdv-next 新版本引入的全新依赖不在清单内,
 *   需 pnpm gen:imports 重新生成(CI verify:imports 会提示)。
 * - Tier2 深子路径(如 @v-c/util/dist/*)的版本取根包级覆盖,子路径布局以
 *   快照为准(假设根包版本升级不改变 dist 子路径布局,与 legacy 模式同一假设)。
 */
const genEsmShImportMap = (
  versions: Partial<Versions>,
  deps: Record<string, string>,
  xdeps: Record<string, string>,
): ImportMap => {
  const ver = (pkg: string, fallback: string) => deps[pkg] ?? fallback
  const imports: Record<string, string> = { ...genTier1Imports(versions) }

  for (const [pkg, info] of Object.entries(RAW_PACKAGES)) {
    imports[pkg] = genCdnLink(pkg, ver(pkg, info.v), info.path)
  }
  for (const [pkg, info] of Object.entries(ESM_PACKAGES)) {
    const v = ver(pkg, info.v)
    imports[pkg] = genEsmShLink(pkg, v)
    for (const sub of info.sub ?? []) {
      imports[`${pkg}/${sub}`] = genEsmShLink(pkg, v, `/${sub}`)
      if (!/\.[a-z]+$/i.test(sub))
        imports[`${pkg}/${sub}.js`] = genEsmShLink(pkg, v, `/${sub}.js`)
    }
  }
  for (const [pkg, fallback] of Object.entries(LEAF_PACKAGES)) {
    if (pkg === 'dayjs') continue
    const v = ver(pkg, fallback)
    // CJS 叶包:esm.sh 的 CJS 命名导出探测不足(实测 fast-color 丢 FastColor、
    // colors 丢全部色板命名导出),走 CDN 可切换 +esm(jsdelivr 的 cjs-module-lexer
    // 识别正确);unpkg 不支持 +esm,退化 esm.sh 根 URL(与 legacy 同限制)。
    // 树内无子路径导入,只登记根 key
    if (CJS_LEAF_PACKAGES.has(pkg)) {
      imports[pkg] = genPlusEsmLink(pkg, v)
      continue
    }
    imports[pkg] = `${ESM_SH}/${pkg}@${v}`
    imports[`${pkg}/`] = `${ESM_SH}/${pkg}@${v}/`
  }
  const dayjsVer = ver('dayjs', LEAF_PACKAGES.dayjs)
  imports.dayjs = genPlusEsmLink('dayjs', dayjsVer)
  imports['dayjs/plugin/'] = `${ESM_SH}/dayjs@${dayjsVer}/plugin/`
  imports['dayjs/locale/'] = `${ESM_SH}/dayjs@${dayjsVer}/locale/`

  applyProXImports(imports, versions, xdeps)
  return { imports }
}

/**
 * legacy 模式(逃生舱):冻结的 static-imports.ts 全量 specifier 枚举 +
 * jsdelivr 原始产物/+esm 转换,行为与 resolver 重构前一致。
 *
 * 静态依赖树与 x 依赖均跟随 `cdn` 设置切换 jsdelivr / fastly / unpkg;
 * +esm 条目(ESM_IMPORTS:dayjs、@ant-design/colors 等)在 unpkg 下退化为
 * esm.sh 转换(jsdelivr/fastly 走原生 +esm)。
 *
 * 版本跟随:静态树是生成时的快照,运行时按所选 antdv-next 版本重新解析其直接
 * 依赖(resolveAntdvDeps)并覆盖版本号;传递依赖叶子与子路径布局仍以静态树为准。
 * x 的 mermaid/prosemirror/shiki 等直接依赖同理随所选 x 版本解析(resolveXDeps)。
 *
 * 已知限制:
 * - 覆盖仅针对静态树中已存在的根包;antdv-next 新版本引入的全新依赖不在树内。
 * - 仅覆盖 antdv-next 运行时可达的裸导入;未映射的子路径导入(如
 *   `antdv-next/locale/fr_FR`)不支持。locale 对象只能由已映射的
 *   @v-c/pagination/locale、@v-c/picker/locale 的 en_US/zh_CN 拼装。
 * - x-markdown / x-card 及 marked/katex/dompurify 不是 x 的依赖,版本手动固定,
 *   需随对应包发版手动更新。
 */
const genLegacyImportMap = (
  versions: Partial<Versions>,
  deps: Record<string, string>,
  xdeps: Record<string, string>,
): ImportMap => {
  const imports: Record<string, string> = {
    ...genTier1Imports(versions),
    ...genStaticCdnImports(deps),
  }
  applyProXImports(imports, versions, xdeps)
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

/**
 * 沙箱 worker 按版本从 CDN 拉取 `lib/typescript.js` 做类型检查(@vue/repl 硬编码该路径)。
 * TypeScript 7 起改为 Go 原生移植版,包内不再有 lib/typescript.js,7.x 无法加载,一律禁用;
 * 6.x 仍是 JS 构建,可正常加载,允许选到 6.x 最新稳定版。
 */
const TS_FALLBACK_VERSION = '6.0.3'

/** 7.x 无法被 worker 加载,下拉中禁用、持久化值回退 */
export const isBlockedTsVersion = (version: string) => gte(version, '7.0.0')

/** 清洗持久化/URL 里的 TS 版本:'latest' 已解析到 7.x,连同 7.x/预发布/非法值一并回退 6.0.3 */
export const sanitizeTsVersion = (v?: string) => {
  const parsed = v ? valid(v) : null
  if (!parsed || parsed.includes('-') || isBlockedTsVersion(parsed)) {
    return TS_FALLBACK_VERSION
  }
  return parsed
}

export const getSupportedTSVersions = () => {
  const versions = getVersions('typescript')
  return computed(() =>
    versions.value.filter(
      (version) =>
        !version.includes('dev') &&
        !version.includes('insiders') &&
        !version.includes('beta') &&
        !version.includes('rc') &&
        gte(version, '5.0.0'),
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
