<!--
首先，感谢你的贡献！
如果你要提交新功能或修复 Bug，请基于 `main` 分支创建 feature/bugfix 分支后再提交。
在提交 Pull Request 前，请确认下方内容已填写完整，方便协作者快速验证。
Pull Request 会在至少一位协作者审核通过后合并。
-->

[English template / 英文模板](./PULL_REQUEST_TEMPLATE.md)

### 🤔 本次变更属于 ...

- [ ] 🐞 Bug 修复
- [ ] 🆕 新功能
- [ ] ⚡️ 性能优化
- [ ] 🛠 重构
- [ ] 📝 文档 / 站点改进
- [ ] 📦 依赖 / import map 更新
- [ ] ⏩ 工作流 / CI
- [ ] 🎨 代码风格优化
- [ ] ❓ 其他（请说明）

### 🔗 相关 Issue

> close #xxxx

### 💡 背景与方案

> - 这个 PR 解决什么问题？如有必要，请贴上报错信息和复现步骤。
> - 根因是什么，为什么这样修？
> - 如果有 UI / 交互变化，请附上修改前后的截图或 GIF。

### 🧪 验证

> 请贴出实际执行过的命令与结果，不适用的条目可删除。

- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm build`
- [ ] `pnpm verify:imports`（仅依赖树 / import map 变更）
- [ ] 浏览器实测（注明 antdv-next 版本、`resolver` 模式、CDN 设置及结果）

### ✅ 检查清单

- [ ] 分支基于 `main` 创建，并合入 `main`。
- [ ] 不包含无关改动、调试代码或仅本地使用的文件。
- [ ] 如果 antdv-next 依赖树发生变化，已执行 `pnpm gen:imports` 重新生成 `src/utils/esm-packages.ts`。
- [ ] 如涉及相关逻辑：切换 antdv-next 版本（`latest` 与旧版本）、`?resolver=esm.sh|legacy`、分享链接仍工作正常。
- [ ] 对外行为或工作流变化已同步更新 `README.md` / `README.zh-CN.md`（如需要）。
