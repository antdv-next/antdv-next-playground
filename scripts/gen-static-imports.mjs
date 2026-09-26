#!/usr/bin/env node
/**
 * 生成 src/utils/esm-packages.ts —— antdv-next 依赖树的 esm.sh 托管清单。
 * (legacy 回退模式用的 static-imports.ts 已冻结,本脚本不再生成。)
 *
 * 用法:
 *   node scripts/gen-static-imports.mjs [version]   # 生成(默认 antdv-next latest)
 *   node scripts/gen-static-imports.mjs --check     # 校验已提交文件与最新依赖树一致(CI 用)
 *
 * 算法:
 *   Phase 1 版本解析:antdv-next 的直接依赖 range 优先(与 npm 提升语义一致),
 *     嵌套依赖按 BFS 先声明者优先解析。
 *   Phase 2 可达性 BFS:从 genImportMap 暴露的 antdv-next 入口(dist/index.js 等)
 *     沿相对导入 + 裸导入遍历整个运行时模块图;只有可达文件的导入才进清单,
 *     天然排除 server-only(es-toolkit/dist/server)与可选生成器(picker generate/*)。
 *   Phase 3 分类输出:
 *     - Tier2(ESM_PACKAGES):会经裸导入引用共享单例(vue/@antdv-next/cssinjs/antdv-next)
 *       的包(默认分类),由 esm.sh ?external= 服务,根 + 公开子路径显式登记;
 *     - Tier3(LEAF_PACKAGES):不引用共享单例的叶子包(显式清单 LEAF_PACKAGE_SET),
 *       import map 只登记根 + 尾斜杠前缀 key,子路径任意拼写由 esm.sh 运行时解析;
 *     - Tier1 补充(RAW_PACKAGES):@antdv-next/icons 走 raw 单文件 bundle
 *       (modular 入口会逐文件请求 852 个图标,不可交给 esm.sh exports 主入口)。
 *
 * 依赖:Node >= 20(global fetch)、系统 tar。无第三方包。
 */
import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import process from 'node:process'

const ANTDV = 'antdv-next'
const OUT_FILE = new URL('../src/utils/esm-packages.ts', import.meta.url)
  .pathname

// genImportMap 动态处理的根,不进入 esm 清单(vue 实例统一由 import map 控制)
const SKIP_ROOTS = new Set(['vue', '@vue/shared', 'antdv-next'])

// Tier3 叶子包显式清单:依赖闭包不含 vue/@antdv-next/cssinjs/antdv-next,
// import map 用「根 + 尾斜杠前缀」两条 key 覆盖其任意子路径拼写,无需枚举。
// 未在清单内的新依赖默认落 Tier2(esm.sh ?external=,对无共享单例的包同样安全);
// 确认是纯叶子后可挪进本清单换取前缀免疫。
const LEAF_PACKAGE_SET = new Set([
  '@ant-design/colors',
  '@ant-design/fast-color',
  '@emotion/hash',
  '@emotion/unitless',
  '@v-c/async-validator',
  '@v-c/mini-decimal',
  'compute-scroll-into-view',
  'dayjs',
  'es-toolkit',
  'resize-observer-polyfill',
  'scroll-into-view-if-needed',
  'stylis',
  'throttle-debounce',
])

// 与 genImportMap 中 antdv-next 子路径保持一致的运行时入口(可达性 BFS 起点)
const ANTDV_SEEDS = [
  'dist/index.js',
  'dist/config-provider/index.js',
  'dist/config-provider/context.js',
  'dist/config-provider/hooks/useCSSVarCls.js',
  'dist/theme/internal.js',
]

// 无 exports/module 指向 ESM 的包,手工指定 ESM 文件(dayjs 官方 esm 构建无 exports map)
const PACKAGE_OVERRIDES = {
  dayjs: (subpath, files) => {
    if (subpath === '.') return findExisting('esm/index.js', files)
    const rel = subpath.replace(/^\.\//, '')
    return (
      findExisting(`esm/${rel}.js`, files) ||
      findExisting(`esm/${rel}/index.js`, files)
    )
  },
  // icons 根指向单文件 bundle:modular 入口(dist/index.js)静态导入全部 852 个
  // 图标文件,浏览器无 tree-shaking 会发 ~1700 个请求;bundle 单请求且仅依赖 vue
  '@antdv-next/icons': (subpath, files) =>
    subpath === '.' ? findExisting('dist/antd-icons.esm.js', files) : null,
}

/* ---------------- 基础工具 ---------------- */

const warn = (msg) => console.warn(`[gen-imports] WARN ${msg}`)

const fetchRetry = async (url, tries = 3) => {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url)
      if (res.ok) return res
      throw new Error(`GET ${url} -> ${res.status}`)
    } catch (error) {
      if (i >= tries) throw error
      warn(`重试 ${url}(${i}/${tries}): ${error.message}`)
      await new Promise((r) => setTimeout(r, 800 * i))
    }
  }
}
const fetchJson = async (url) => {
  const res = await fetchRetry(url)
  return res.json()
}

// ---- 极简 semver(range 仅覆盖本依赖树的 ^/~/精确/*/latest 形态) ----
const parseVer = (v) => {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v)
  return m ? [+m[1], +m[2], +m[3]] : null
}
const cmpVer = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
const satisfies = (v, range) => {
  const p = parseVer(v)
  if (!p) return false
  const r = range.trim()
  if (!r || r === '*' || r === 'latest' || r === 'x') return true
  const parts = r.split('||').map((s) => s.trim())
  for (const part of parts) {
    const op = part.startsWith('^') ? '^' : part.startsWith('~') ? '~' : ''
    const want = parseVer(op ? part.slice(1) : part)
    if (!want) continue
    const c = cmpVer(p, want)
    if (op === '^') {
      const upper = want[0] > 0 ? [want[0] + 1, 0, 0] : [0, want[1] + 1, 0]
      if (c >= 0 && cmpVer(p, upper) < 0) return true
    } else if (op === '~') {
      if (c >= 0 && p[0] === want[0] && p[1] === want[1]) return true
    } else if (c === 0) {
      return true
    }
  }
  return false
}
const maxSatisfying = (versions, range) =>
  versions.findLast((v) => satisfies(v, range))

// ---- 版本解析(data.jsdelivr.com 版本列表 + 本地 semver) ----
const versionsCache = new Map()
const getVersions = (pkg) => {
  if (!versionsCache.has(pkg)) {
    versionsCache.set(
      pkg,
      fetchJson(`https://data.jsdelivr.com/v1/package/npm/${pkg}`).then(
        (data) =>
          (data.versions || [])
            .filter((v) => parseVer(v))
            .toSorted((a, b) => cmpVer(parseVer(a), parseVer(b))),
      ),
    )
  }
  return versionsCache.get(pkg)
}
const resolveVersion = async (pkg, range) => {
  const versions = await getVersions(pkg)
  const hit = maxSatisfying(versions, range || 'latest')
  if (!hit) throw new Error(`无法解析 ${pkg}@${range || 'latest'}`)
  return hit
}

// ---- tarball 下载/解压(固定缓存目录,跨运行复用) ----
const dirCache = new Map()
const fileCache = new Map()
const TMP_ROOT = join(tmpdir(), 'gen-static-imports-cache')
mkdirSync(TMP_ROOT, { recursive: true })
const getPackageDir = async (pkg, ver) => {
  const key = `${pkg}@${ver}`
  if (dirCache.has(key)) return dirCache.get(key)
  const dir = join(TMP_ROOT, key.replaceAll('/', '__'))
  if (!existsSync(dir)) {
    const url = `https://registry.npmjs.org/${encodeURIComponent(pkg)}/-/${basename(pkg)}-${ver}.tgz`
    const tgz = join(TMP_ROOT, `${key.replaceAll('/', '__')}.tgz`)
    const res = await fetchRetry(url)
    writeFileSync(tgz, Buffer.from(await res.arrayBuffer()))
    mkdirSync(dir, { recursive: true })
    execFileSync('tar', ['-xzf', tgz, '--strip-components=1', '-C', dir], {
      stdio: 'pipe',
    })
  }
  dirCache.set(key, dir)
  return dir
}
const readPkgJson = (dir) =>
  JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))

const walkFiles = (dir, rel = '') => {
  const out = []
  for (const name of readdirSync(join(dir, rel))) {
    if (name === 'node_modules') continue
    const full = join(dir, rel, name)
    const relPath = rel ? `${rel}/${name}` : name
    if (statSync(full).isDirectory()) out.push(...walkFiles(dir, relPath))
    else out.push(relPath)
  }
  return out
}
const getFileSet = async (pkg, ver) => {
  const key = `${pkg}@${ver}`
  if (!fileCache.has(key)) {
    const dir = await getPackageDir(pkg, ver)
    fileCache.set(key, new Set(walkFiles(dir)))
  }
  return fileCache.get(key)
}

// ---- 裸导入扫描 ----
// from"x" / from "x" / import("x") / import "x" 均覆盖(压缩产物可能无空格)
const IMPORT_RE =
  /(?:^|[^\w.$])(?:from\s*|import\s*\(\s*|import\s*)(["'])([^"']+)\1/g
const scanImports = (src) => {
  const stripped = src
    .replaceAll(/\/\*[\s\S]*?\*\//g, ' ')
    .replaceAll(/(^|[^:\\])\/\/.*$/gm, '$1')
    .replaceAll(/`[^`]*`/g, ' ')
  const out = []
  for (const m of stripped.matchAll(IMPORT_RE)) out.push(m[2])
  return out
}
const splitSpec = (spec) => {
  if (spec.startsWith('@')) {
    const i = spec.indexOf('/')
    const j = spec.indexOf('/', i + 1)
    if (j === -1) return { root: spec, subpath: '' }
    return { root: spec.slice(0, j), subpath: spec.slice(j + 1) }
  }
  const i = spec.indexOf('/')
  return i === -1
    ? { root: spec, subpath: '' }
    : { root: spec.slice(0, i), subpath: spec.slice(i + 1) }
}

// ---- 相对导入解析(同包内,禁止逃逸包根) ----
const resolveRel = (pkgDir, file, spec) => {
  const abs = join(pkgDir, dirname(file), spec)
  const rel = abs.startsWith(pkgDir) ? abs.slice(pkgDir.length + 1) : null
  if (!rel) return null
  for (const c of [
    rel,
    `${rel}.js`,
    `${rel}.mjs`,
    `${rel}/index.js`,
    `${rel}/index.mjs`,
  ]) {
    if (existsSync(join(pkgDir, c))) return c
  }
  return null
}

/* ---------------- 路径解析 ---------------- */

const findExisting = (target, files) => {
  const base = target.replace(/^\.\//, '')
  for (const c of [
    base,
    `${base}.js`,
    `${base}.mjs`,
    `${base}/index.js`,
    `${base}/index.mjs`,
  ]) {
    if (files.has(c)) return c
  }
  return null
}

const pickCondition = (node) => {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = pickCondition(n)
      if (r) return r
    }
    return null
  }
  if (node && typeof node === 'object') {
    for (const key of ['import', 'browser', 'default']) {
      if (node[key] !== undefined) {
        const r = pickCondition(node[key])
        if (r) return r
      }
    }
  }
  return null
}

const resolveExports = (exp, subpath, files) => {
  if (typeof exp !== 'object' || exp === null || Array.isArray(exp)) return null
  // 精确 key 优先
  const exact = pickCondition(exp[subpath])
  if (exact && typeof exact === 'string') {
    const hit = findExisting(exact, files)
    if (hit) return hit
  }
  // 模式 key 按前缀长度降序(与 Node 特异性规则一致)
  const patterns = Object.keys(exp)
    .filter((k) => k.includes('*'))
    .toSorted((a, b) => b.split('*')[0].length - a.split('*')[0].length)
  for (const key of patterns) {
    const [pre, post] = key.split('*')
    if (!subpath.startsWith(pre) || !subpath.endsWith(post)) continue
    const star = subpath.slice(pre.length, subpath.length - post.length)
    const target = pickCondition(exp[key])
    if (typeof target === 'string') {
      const hit = findExisting(target.replace('*', star), files)
      if (hit) return hit
    }
  }
  return null
}

const resolveLegacy = (pkgJson, subpath, files) => {
  if (subpath === '.')
    return findExisting(pkgJson.module || pkgJson.main || 'index.js', files)
  return findExisting(subpath, files)
}

// 统一解析顺序:override(手工指定,优先) -> exports map -> legacy
const resolveSpecFile = (root, pkgJson, norm, files) => {
  const override = PACKAGE_OVERRIDES[root]
  if (override) {
    const hit = override(norm, files)
    if (hit) return hit
  }
  return (
    resolveExports(pkgJson.exports, norm, files) ||
    resolveLegacy(pkgJson, norm, files)
  )
}

/* ---------------- 主流程 ---------------- */

async function generate() {
  const checkMode = process.argv.includes('--check')
  const wanted = checkMode ? 'latest' : (process.argv[2] ?? 'latest')
  const antdvVer = await resolveVersion(ANTDV, wanted)
  console.log(`[gen-imports] antdv-next -> ${antdvVer}`)

  // ---- Phase 1:版本解析(antdv 直接依赖 range 最高优先) ----
  const pkgVersions = new Map([[ANTDV, antdvVer]])
  const pkgJsonCache = new Map()
  const antdvDir = await getPackageDir(ANTDV, antdvVer)
  const antdvPkgJson = readPkgJson(antdvDir)
  pkgJsonCache.set(`${ANTDV}@${antdvVer}`, {
    pkgJson: antdvPkgJson,
    dir: antdvDir,
  })

  const queue = []
  for (const [dep, range] of Object.entries(antdvPkgJson.dependencies || {})) {
    const dver = await resolveVersion(dep, range)
    pkgVersions.set(dep, dver)
    queue.push([dep, dver])
    console.log(`[gen-imports]   ${dep}@${range} -> ${dver}`)
  }
  while (queue.length) {
    const [pkg, ver] = queue.shift()
    if (pkgJsonCache.has(`${pkg}@${ver}`)) continue
    const dir = await getPackageDir(pkg, ver)
    const pkgJson = readPkgJson(dir)
    pkgJsonCache.set(`${pkg}@${ver}`, { pkgJson, dir })
    for (const [dep, range] of Object.entries(pkgJson.dependencies || {})) {
      if (pkgVersions.has(dep)) continue
      const dver = await resolveVersion(dep, range)
      pkgVersions.set(dep, dver)
      queue.push([dep, dver])
      console.log(`[gen-imports]   ${dep}@${range} -> ${dver}`)
    }
  }
  console.log(`[gen-imports] 依赖树包数: ${pkgVersions.size}`)

  // ---- Phase 2:可达性 BFS(从 antdv 运行时入口出发,只收可达文件的导入) ----
  const visited = new Set()
  const specifiers = new Map() // spec -> { root, subpath, file }
  const bfs = ANTDV_SEEDS.map((f) => [ANTDV, antdvVer, f])
  while (bfs.length) {
    const [pkg, ver, file] = bfs.shift()
    const vkey = `${pkg}@${ver}/${file}`
    if (visited.has(vkey)) continue
    visited.add(vkey)
    const { dir: pkgDir } = pkgJsonCache.get(`${pkg}@${ver}`)
    const abs = join(pkgDir, file)
    if (!existsSync(abs)) {
      warn(`入口文件不存在:${vkey},跳过`)
      continue
    }
    const src = readFileSync(abs, 'utf8')
    for (const spec of scanImports(src)) {
      if (spec.startsWith('.')) {
        const hit = resolveRel(pkgDir, file, spec)
        if (hit) bfs.push([pkg, ver, hit])
        else warn(`相对导入无法解析:${vkey} -> "${spec}"`)
        continue
      }
      if (/^(?:https?:|data:|\/)/.test(spec) || spec.startsWith('node:')) {
        continue
      }
      const { root, subpath } = splitSpec(spec)
      if (root.startsWith('@vue/')) {
        warn(`@vue/* 裸导入 "${spec}"(${vkey}) 需在 genImportMap 显式映射`)
        continue
      }
      if (SKIP_ROOTS.has(root)) continue
      const rver = pkgVersions.get(root)
      if (!rver) {
        warn(`裸导入 "${spec}"(${vkey}) 不在依赖树中,跳过`)
        continue
      }
      const { pkgJson: rJson } = pkgJsonCache.get(`${root}@${rver}`)
      const files = await getFileSet(root, rver)
      const norm = subpath === '' ? '.' : `./${subpath}`
      const rfile = resolveSpecFile(root, rJson, norm, files)
      if (!rfile) {
        warn(`无法解析 "${spec}"(${vkey}),跳过`)
        continue
      }
      specifiers.set(spec, { root, subpath, file: rfile })
      bfs.push([root, rver, rfile])
    }
  }
  console.log(
    `[gen-imports] 可达文件: ${visited.size},specifier: ${specifiers.size}`,
  )

  // ---- Phase 3:分类输出 esm-packages.ts ----
  const esmPackages = new Map() // pkg -> { v, sub: Set }
  const leafPackages = new Map() // pkg -> version
  const rawPackages = new Map() // pkg -> { v, path }
  for (const [, { root, subpath, file }] of specifiers) {
    const ver = pkgVersions.get(root)
    if (root === '@antdv-next/icons') {
      rawPackages.set(root, { v: ver, path: `/${file}` })
      continue
    }
    if (LEAF_PACKAGE_SET.has(root)) {
      if (!leafPackages.has(root)) leafPackages.set(root, ver)
      continue
    }
    if (!esmPackages.has(root))
      esmPackages.set(root, { v: ver, sub: new Set() })
    if (subpath) esmPackages.get(root).sub.add(subpath)
  }
  console.log(
    `[gen-imports] Tier2: ${esmPackages.size} 包,Tier3 叶子: ${leafPackages.size} 包,raw: ${rawPackages.size} 包`,
  )

  const date = new Date().toISOString().slice(0, 10)
  const sortedEntries = (map) =>
    [...map.entries()].toSorted(([a], [b]) => a.localeCompare(b))
  const body = [
    `// 自动生成:node scripts/gen-static-imports.mjs ${antdvVer}(${date}),勿手改`,
    `// antdv-next@${antdvVer} 依赖树的 esm.sh 托管清单(从 genImportMap 暴露的入口沿模块图 BFS 得出):`,
    `//   - 版本号仅作回退值;运行时按所选 antdv-next 版本重新解析直接依赖并覆盖(resolveAntdvDeps)`,
    `//   - 重新生成:pnpm gen:imports(取当前 antdv-next latest);CI 校验:pnpm verify:imports`,
    `//   - legacy 回退模式(?resolver=legacy)用的是已冻结的 static-imports.ts,与本文件无关`,
    ``,
    `/** Tier2:经裸导入引用共享单例(vue/@antdv-next/cssinjs/antdv-next)的包,`,
    ` *  由 esm.sh ?external= 服务;sub 为需显式登记的公开/深子路径(根条目恒有) */`,
    `export const ESM_PACKAGES: Record<string, { v: string; sub?: string[] }> = {`,
    ...sortedEntries(esmPackages).map(([pkg, { v, sub }]) => {
      const subs = [...sub].toSorted()
      return subs.length
        ? `  '${pkg}': { v: '${v}', sub: [${subs.map((s) => `'${s}'`).join(', ')}] },`
        : `  '${pkg}': { v: '${v}' },`
    }),
    `}`,
    ``,
    `/** Tier3:不引用共享单例的叶子包,import map 登记根 + 尾斜杠前缀 key,`,
    ` *  任意子路径拼写(含 .js 后缀漂移)由 esm.sh 运行时解析 */`,
    `export const LEAF_PACKAGES: Record<string, string> = {`,
    ...sortedEntries(leafPackages).map(([pkg, v]) => `  '${pkg}': '${v}',`),
    `}`,
    ``,
    `/** Tier1 补充:raw dist 单文件 bundle(esm.sh 会走 exports 主入口逐文件请求,不可搬) */`,
    `export const RAW_PACKAGES: Record<string, { v: string; path: string }> = {`,
    ...sortedEntries(rawPackages).map(
      ([pkg, { v, path }]) => `  '${pkg}': { v: '${v}', path: '${path}' },`,
    ),
    `}`,
    ``,
  ].join('\n')

  if (checkMode) {
    const disk = readFileSync(OUT_FILE, 'utf8')
    // 值与格式无关比较:剥掉注释/export/类型标注后求值
    const toValue = (src) => {
      const js = src
        .replaceAll(/^\/\/.*$/gm, '')
        .replaceAll(/\/\*\*[\s\S]*?\*\//g, '')
        .replaceAll(/^export /gm, '')
        .replaceAll(/: Record<string, [^\n=]+>/g, '')
      return new Function(
        `${js}; return { ESM_PACKAGES, LEAF_PACKAGES, RAW_PACKAGES }`,
      )()
    }
    // 版本号由运行时按所选版本解析(resolveAntdvDeps),清单版本仅作回退值;
    // 对比时剥掉版本,只校验结构(包集合/子路径集合/raw 路径)。
    const stripVersions = (value) =>
      JSON.stringify({
        esm: Object.fromEntries(
          Object.entries(value.ESM_PACKAGES).map(([pkg, info]) => [
            pkg,
            [...(info.sub ?? [])].toSorted(),
          ]),
        ),
        leaf: Object.keys(value.LEAF_PACKAGES).toSorted(),
        raw: Object.fromEntries(
          Object.entries(value.RAW_PACKAGES).map(([pkg, info]) => [
            pkg,
            info.path,
          ]),
        ),
      })
    const diskValue = toValue(disk)
    const bodyValue = toValue(body)
    if (stripVersions(diskValue) === stripVersions(bodyValue)) {
      const drifted = [
        ...Object.entries(bodyValue.ESM_PACKAGES).filter(
          ([pkg, info]) => diskValue.ESM_PACKAGES[pkg]?.v !== info.v,
        ),
        ...Object.entries(bodyValue.LEAF_PACKAGES).filter(
          ([pkg, v]) => diskValue.LEAF_PACKAGES[pkg] !== v,
        ),
      ]
      if (drifted.length) {
        console.log(
          `[gen-imports] OK:结构与 antdv-next@${antdvVer} 一致;${drifted.length} 个包版本漂移` +
            `(运行时按所选版本解析,如需刷新回退值请运行 pnpm gen:imports):`,
        )
        for (const [pkg, info] of drifted.slice(0, 12)) {
          const to = typeof info === 'string' ? info : info.v
          const from =
            diskValue.ESM_PACKAGES[pkg]?.v ?? diskValue.LEAF_PACKAGES[pkg]
          console.log(`[gen-imports]   ${pkg}: ${from} -> ${to}`)
        }
      } else {
        console.log(
          `[gen-imports] OK:${OUT_FILE} 与 antdv-next@${antdvVer} 依赖树结构一致`,
        )
      }
      return 0
    }
    console.error(
      `[gen-imports] FAIL:${OUT_FILE} 结构过期(包/子路径集合变化),请运行 pnpm gen:imports 重新生成`,
    )
    return 1
  }

  writeFileSync(OUT_FILE, body)
  try {
    execFileSync('pnpm', ['exec', 'prettier', '--write', OUT_FILE], {
      stdio: 'pipe',
    })
  } catch {
    warn(`prettier 不可用,输出未格式化(内容正确)`)
  }
  console.log(`[gen-imports] 已写入 ${OUT_FILE}`)
  return 0
}

generate()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
