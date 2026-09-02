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
  resolveAntdvDeps,
  resolveXDeps,
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
    typescript: saved?._o?.tsVersion ?? 'latest',
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
    tsVersion: saved?._o?.tsVersion,
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
  // 按所选 antdv-next 版本解析其直接依赖的精确版本,覆盖静态树快照;
  // 解析期间(或失败时)保持静态树,import map 不闪断
  const resolvedDeps = shallowRef<Record<string, string>>({})
  const refreshDeps = useDebounceFn(async () => {
    resolvedDeps.value = await resolveAntdvDeps(versions.antdvNext)
  }, 300)
  watch(() => versions.antdvNext, refreshDeps, { immediate: true })
  // x 的 mermaid/prosemirror/shiki 直接依赖同理随所选 x 版本解析
  const resolvedXDeps = shallowRef<Record<string, string>>({})
  const refreshXDeps = useDebounceFn(async () => {
    resolvedXDeps.value = await resolveXDeps(versions.x)
  }, 300)
  watch(() => versions.x, refreshXDeps, { immediate: true })
  const hideFile = !IS_DEV && !userOptions.showHidden

  if (pr) useWorker(pr)
  const builtinImportMap = computed<ImportMap>(() => {
    // PR 预览模式下 antdv-next 来自 PR 构建，pro/x 的 ?deps= 无法解析 preview 版本，禁用
    let importMap = genImportMap(
      {
        ...versions,
        pro: pr ? undefined : featureFlags.pro ? versions.pro : undefined,
        x: pr ? undefined : featureFlags.x ? versions.x : undefined,
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
    () => [versions.antdvNext, versions.x, featureFlags.x, featureFlags.pro],
    () => {
      store.files[ANTDV_NEXT_FILE].code = generateAntdvNextCode(
        versions.antdvNext,
        userOptions.styleSource,
        pr ? undefined : featureFlags.x ? versions.x : undefined,
        pr ? undefined : featureFlags.pro ? versions.pro : undefined,
      ).trim()
      originalCompileFile(store, store.files[ANTDV_NEXT_FILE]).then(
        (errs) => (store.errors = errs),
      )
    },
  )
  // 记录生效中的 builtin map;首次变更即可对比移除消失的托管键
  let prevBuiltinImportMap: ImportMap = builtinImportMap.value
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
          versions.antdvNext,
          userOptions.styleSource,
          pr ? undefined : featureFlags.x ? versions.x : undefined,
          pr ? undefined : featureFlags.pro ? versions.pro : undefined,
        ),
      )
    }
    if (!files[TSCONFIG]) {
      files[TSCONFIG] = new File(TSCONFIG, tsconfigCode)
    }
    return files
  }
  async function setVueVersion(version: string) {
    store.compiler = await import(
      /* @vite-ignore */ genCompilerSfcLink(version)
    )
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
