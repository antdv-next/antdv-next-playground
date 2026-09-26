import {
  File,
  mergeImportMap,
  compileFile as originalCompileFile,
  useStore as useReplStore,
  type ImportMap,
  type StoreState,
} from '@vue/repl'
import { objectOmit } from '@vueuse/core'
import { IS_DEV } from '@/constants'
import {
  genCdnLink,
  genCompilerSfcLink,
  genImportMap,
  getManagedImportKeys,
  resolveAntdvDeps,
  resolveDistTag,
  resolver,
  resolveXDeps,
  sanitizeTsVersion,
} from '@/utils/dependency'
import { atou, utoa } from '@/utils/encode'
import antdvNextCode from '../template/antdv-next.js?raw'
import mainCode from '../template/main.vue?raw'
import tsconfigCode from '../template/tsconfig.json?raw'
import welcomeCode from '../template/welcome.vue?raw'

export interface Initial {
  serializedState?: string
  initialized?: () => void
}
export type VersionKey = 'vue' | 'antdvNext' | 'typescript' | 'pro' | 'x'
export type Versions = Record<VersionKey, string>
export interface UserOptions {
  styleSource?: string
  showHidden?: boolean
  vueVersion?: string
  tsVersion?: string
  antdvVersion?: string
  proVersion?: string
  xVersion?: string
  proEnabled?: boolean
  xEnabled?: boolean
  vuePr?: string
}
export type SerializeState = Record<string, string> & {
  _o?: UserOptions
}

const MAIN_FILE = 'src/PlaygroundMain.vue'
const APP_FILE = 'src/App.vue'
const ANTDV_NEXT_FILE = 'src/antdv-next.js'
const LEGACY_IMPORT_MAP = 'src/import_map.json'
export const IMPORT_MAP = 'import-map.json'
export const TSCONFIG = 'tsconfig.json'

export const useStore = (initial: Initial) => {
  const saved: SerializeState | undefined = initial.serializedState
    ? deserialize(initial.serializedState)
    : undefined
  const pr =
    new URLSearchParams(location.search).get('pr') ||
    saved?._o?.styleSource?.match(/antdv-next@([^/]+)/)?.[1]
  const prUrl = `https://raw.esm.sh/pr/antdv-next@${pr}/dist`
  const vuePr =
    new URLSearchParams(location.search).get('vue') || saved?._o?.vuePr
  const vuePrUrl = `https://esm.sh/pr`

  const versions = reactive<Versions>({
    vue: saved?._o?.vueVersion ?? 'latest',
    antdvNext: pr ? 'preview' : (saved?._o?.antdvVersion ?? 'latest'),
    typescript: sanitizeTsVersion(saved?._o?.tsVersion),
    pro: saved?._o?.proVersion ?? 'latest',
    x: saved?._o?.xVersion ?? 'latest',
  })
  const userOptions: UserOptions = {}
  if (pr) {
    Object.assign(userOptions, {
      showHidden: true,
      styleSource: `${prUrl}/antd.css`,
    })
  }
  if (vuePr) {
    Object.assign(userOptions, {
      vuePr,
    })
  }
  Object.assign(userOptions, {
    vueVersion: saved?._o?.vueVersion,
    tsVersion: sanitizeTsVersion(saved?._o?.tsVersion),
    antdvVersion: saved?._o?.antdvVersion,
    proVersion: saved?._o?.proVersion,
    xVersion: saved?._o?.xVersion,
    proEnabled: saved?._o?.proEnabled,
    xEnabled: saved?._o?.xEnabled,
  })
  // 是否把 pro / x 依赖写入 import map。
  // 默认关闭;可通过 URL 参数 ?pro=1 / ?x=1 开启(docs 页链接玩法);
  // 用户显式切换后由 _o.proEnabled / _o.xEnabled 记录,优先于参数。
  const queryParams = new URLSearchParams(location.search)
  const paramFlag = (name: string, fallback: boolean) => {
    const raw = queryParams.get(name)
    if (raw === null) return fallback
    return !['0', 'false', 'no', 'off'].includes(raw.toLowerCase())
  }
  const featureFlags = reactive({
    pro: saved?._o?.proEnabled ?? paramFlag('pro', false),
    x: saved?._o?.xEnabled ?? paramFlag('x', false),
  })
  watch(
    () => featureFlags.pro,
    (v) => (userOptions.proEnabled = v),
  )
  watch(
    () => featureFlags.x,
    (v) => (userOptions.xEnabled = v),
  )
  // URL 构建统一使用精确版本:jsdelivr 系 CDN 对 @latest 按路径独立缓存,
  // 会混发不同年代文件(实测 jsdmirror 的 antdv-next@latest 部分路径还是旧版,
  // 直接造成 named export 缺失)。latest 等 tag 先经 resolveDistTag 解析,
  // 解析期间(或失败时)回退原 tag;版本选择器 UI 仍显示原始 tag
  const exactVersions = reactive({
    vue: versions.vue,
    antdvNext: versions.antdvNext,
    pro: versions.pro,
    x: versions.x,
  })
  let exactSeq = 0
  watch(
    () => [versions.vue, versions.antdvNext, versions.pro, versions.x],
    async ([vue, antdvNext, pro, x]) => {
      const seq = ++exactSeq
      const [ev, ea, ep, ex] = await Promise.all([
        resolveDistTag('vue', vue),
        resolveDistTag('antdv-next', antdvNext),
        resolveDistTag('@antdv-next/pro', pro),
        resolveDistTag('@antdv-next/x', x),
      ])
      if (seq !== exactSeq) return // 期间又切换过,丢弃过期结果
      exactVersions.vue = ev
      exactVersions.antdvNext = ea
      exactVersions.pro = ep
      exactVersions.x = ex
    },
    { immediate: true },
  )
  // 按所选 antdv-next 版本解析其直接依赖的精确版本,覆盖清单回退版本;
  // 解析期间(或失败时)保持清单版本,import map 不闪断。
  // resolver 切换后按新模式重新解析(候选包集与探测规则随模式不同)
  const resolvedDeps = shallowRef<Record<string, string>>({})
  const refreshDeps = useDebounceFn(async () => {
    resolvedDeps.value = await resolveAntdvDeps(exactVersions.antdvNext)
  }, 300)
  watch([() => exactVersions.antdvNext, resolver], refreshDeps, {
    immediate: true,
  })
  // x 的 mermaid/prosemirror/shiki 直接依赖同理随所选 x 版本解析
  const resolvedXDeps = shallowRef<Record<string, string>>({})
  const refreshXDeps = useDebounceFn(async () => {
    resolvedXDeps.value = await resolveXDeps(exactVersions.x)
  }, 300)
  watch(() => exactVersions.x, refreshXDeps, { immediate: true })
  const hideFile = !IS_DEV && !userOptions.showHidden

  if (pr) useWorker(pr)
  const builtinImportMap = computed<ImportMap>(() => {
    // PR 预览模式下 antdv-next 来自 PR 构建，pro/x 的 ?deps= 无法解析 preview 版本，禁用
    let importMap = genImportMap(
      {
        ...versions,
        vue: exactVersions.vue,
        antdvNext: exactVersions.antdvNext,
        pro: pr ? undefined : featureFlags.pro ? exactVersions.pro : undefined,
        x: pr ? undefined : featureFlags.x ? exactVersions.x : undefined,
      },
      resolvedDeps.value,
      resolvedXDeps.value,
    )
    if (pr)
      importMap = mergeImportMap(importMap, {
        imports: {
          'antdv-next': `${prUrl}/antd.esm.js`,
          'antdv-next/': `https://raw.esm.sh/pr/antdv-next@${pr}/`,
        },
      })

    if (vuePr)
      importMap = mergeImportMap(importMap, {
        imports: {
          vue: `${vuePrUrl}/vue@${vuePr}`,
          '@vue/shared': `${vuePrUrl}/@vue/shared@${vuePr}`,
        },
      })
    return importMap
  })

  const storeState: Partial<StoreState> = toRefs(
    reactive({
      files: initFiles(),
      mainFile: MAIN_FILE,
      activeFilename: APP_FILE,
      vueVersion: computed(() => versions.vue),
      typescriptVersion: versions.typescript,
      builtinImportMap,
      template: {
        welcomeSFC: mainCode,
      },
      sfcOptions: {
        script: {
          propsDestructure: true,
        },
      },
    }),
  )
  const store = useReplStore(storeState)
  store.files[ANTDV_NEXT_FILE].hidden = hideFile
  store.files[MAIN_FILE].hidden = hideFile
  setVueVersion(versions.vue).then(() => {
    initial.initialized?.()
  })

  watch(
    () => [
      exactVersions.antdvNext,
      exactVersions.x,
      exactVersions.pro,
      featureFlags.x,
      featureFlags.pro,
    ],
    () => {
      store.files[ANTDV_NEXT_FILE].code = generateAntdvNextCode(
        exactVersions.antdvNext,
        userOptions.styleSource,
        pr ? undefined : featureFlags.x ? exactVersions.x : undefined,
        pr ? undefined : featureFlags.pro ? exactVersions.pro : undefined,
      ).trim()
      originalCompileFile(store, store.files[ANTDV_NEXT_FILE]).then(
        (errs) => (store.errors = errs),
      )
    },
  )
  // 记录生效中的 builtin map;首次变更即可对比移除消失的托管键。
  // 初值取两模式托管 key 并集:跨模式分享链接(resolver 切换前序列化)里
  // 残留的旧模式 key 会在 resolveAntdvDeps 完成引发的首次变更时一并清掉
  let prevBuiltinImportMap: ImportMap = {
    imports: Object.fromEntries(
      [...getManagedImportKeys()].map((key) => [key, '']),
    ),
  }
  watch(
    builtinImportMap,
    (newBuiltinImportMap) => {
      const importMap = JSON.parse(store.files[IMPORT_MAP].code)
      // 关闭 pro / x(或 CDN 切换使某键消失)时,移除已从 builtin 消失的托管键,
      // 避免 import map 残留旧条目仍被沙箱解析
      if (prevBuiltinImportMap) {
        const prevImports = prevBuiltinImportMap.imports ?? {}
        const newImports = newBuiltinImportMap.imports ?? {}
        for (const key of Object.keys(prevImports)) {
          if (!(key in newImports)) {
            delete importMap.imports?.[key]
          }
        }
      }
      prevBuiltinImportMap = newBuiltinImportMap
      store.files[IMPORT_MAP].code = JSON.stringify(
        mergeImportMap(importMap, newBuiltinImportMap),
        undefined,
        2,
      )
    },
    { deep: true },
  )

  function init() {
    watchEffect(() => {
      originalCompileFile(store, store.activeFile).then(
        (errs) => (store.errors = errs),
      )
    })
    for (const [filename, file] of Object.entries(store.files)) {
      if (filename === store.activeFilename) continue
      originalCompileFile(store, file).then((errs) =>
        store.errors.push(...errs),
      )
    }

    watch(
      () => [
        store.files[TSCONFIG]?.code,
        store.typescriptVersion,
        store.locale,
        store.dependencyVersion,
        store.vueVersion,
      ],
      useDebounceFn(() => store.reloadLanguageTools?.(), 300),
      { deep: true },
    )
  }
  function serialize() {
    const state: SerializeState = { ...store.getFiles() }
    state._o = userOptions
    return utoa(JSON.stringify(state))
  }
  function deserialize(text: string): SerializeState {
    const state = JSON.parse(atou(text))
    return state
  }
  function initFiles() {
    const files: Record<string, File> = Object.create(null)
    if (saved) {
      for (let [filename, file] of Object.entries(objectOmit(saved, ['_o']))) {
        if (
          ![IMPORT_MAP, TSCONFIG].includes(filename) &&
          !filename.startsWith('src/')
        ) {
          filename = `src/${filename}`
        }
        if (filename === LEGACY_IMPORT_MAP) {
          filename = IMPORT_MAP
        }
        files[filename] = new File(filename, file as string)
      }
    } else {
      files[APP_FILE] = new File(APP_FILE, welcomeCode)
    }
    if (!files[ANTDV_NEXT_FILE]) {
      files[ANTDV_NEXT_FILE] = new File(
        ANTDV_NEXT_FILE,
        generateAntdvNextCode(
          exactVersions.antdvNext,
          userOptions.styleSource,
          pr ? undefined : featureFlags.x ? exactVersions.x : undefined,
          pr ? undefined : featureFlags.pro ? exactVersions.pro : undefined,
        ),
      )
    }
    if (!files[TSCONFIG]) {
      files[TSCONFIG] = new File(TSCONFIG, tsconfigCode)
    }
    return files
  }
  async function setVueVersion(version: string) {
    // compiler-sfc 的 URL 也用精确版本,避免 CDN 对 @latest 混发新旧文件
    const exact = await resolveDistTag('vue', version)
    store.compiler = await import(/* @vite-ignore */ genCompilerSfcLink(exact))
    versions.vue = version
  }
  async function setVersion(key: VersionKey, version: string) {
    switch (key) {
      case 'vue':
        userOptions.vueVersion = version
        await setVueVersion(version)
        break
      case 'antdvNext':
        versions.antdvNext = version
        userOptions.antdvVersion = version
        break
      case 'pro':
        versions.pro = version
        userOptions.proVersion = version
        break
      case 'x':
        versions.x = version
        userOptions.xVersion = version
        break
      case 'typescript':
        store.typescriptVersion = version
        versions.typescript = version
        userOptions.tsVersion = version
        break
    }
  }
  const resetFiles = () => {
    const { files, addFile } = store

    const isRandomFile = (filename: string) =>
      ![MAIN_FILE, TSCONFIG, IMPORT_MAP, ANTDV_NEXT_FILE].includes(filename)
    for (const filename of Object.keys(files))
      if (isRandomFile(filename)) delete files[filename]

    const appFile = new File(APP_FILE, welcomeCode, false)
    addFile(appFile)
  }

  const setFeature = (key: keyof typeof featureFlags, enabled: boolean) => {
    featureFlags[key] = enabled
  }
  const utils = {
    versions,
    pr,
    setVersion,
    serialize,
    init,
    vuePr,
    resetFiles,
    featureFlags,
    setFeature,
  }
  Object.assign(store, utils)

  return store as typeof store & typeof utils
}

function generateAntdvNextCode(
  version: string,
  styleSource?: string,
  xVersion?: string,
  proVersion?: string,
) {
  const style = styleSource
    ? styleSource.replace('#VERSION#', version)
    : genCdnLink('antdv-next', version, '/dist/antd.css')
  const resetStyle = genCdnLink('antdv-next', version, '/dist/reset.css')
  // X 开启时全局注册,沙箱内可直接用文档同款 <ax-welcome> 等组件(组件 name 为 Ax*)
  const xImport = xVersion ? `import AntdvX from '@antdv-next/x'` : ''
  const xSetup = xVersion ? `  instance.appContext.app.use(AntdvX)` : ''
  // Pro 开启时全局注册:主入口 install 会 app.use 各组件(ProConfigProvider、AScrollbar),
  // 沙箱内可直接用 <a-scrollbar> 等组件
  const proImport = proVersion ? `import AntdvPro from '@antdv-next/pro'` : ''
  const proSetup = proVersion ? `  instance.appContext.app.use(AntdvPro)` : ''
  return antdvNextCode
    .replace('#STYLE#', style)
    .replace('#RESETSTYLE#', resetStyle)
    .replace('#X_IMPORT#', xImport)
    .replace('#X_SETUP#', xSetup)
    .replace('#PRO_IMPORT#', proImport)
    .replace('#PRO_SETUP#', proSetup)
}

function useWorker(pr: string) {
  const _worker = globalThis.Worker
  globalThis.Worker = class extends _worker {
    constructor(url: URL | string, options?: WorkerOptions) {
      if (typeof url === 'string' && url.includes('vue.worker')) {
        url = `${url}?pr=${pr}`
      }
      super(url, options)
    }
  }
}

export type Store = ReturnType<typeof useStore>
