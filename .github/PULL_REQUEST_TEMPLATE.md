<!--
First of all, thank you for your contribution!
Please base feature/bugfix branches on `main`.
Before submitting, fill in the sections below so reviewers can verify the change quickly.
Your pull request will be merged after one of the collaborators approves.
-->

[中文版模板 / Chinese template](./PULL_REQUEST_TEMPLATE_CN.md)

### 🤔 This is a ...

- [ ] 🐞 Bug fix
- [ ] 🆕 New feature
- [ ] ⚡️ Performance optimization
- [ ] 🛠 Refactoring
- [ ] 📝 Documentation / site improvement
- [ ] 📦 Dependency / import map update
- [ ] ⏩ Workflow / CI
- [ ] 🎨 Code style
- [ ] ❓ Other (about what?)

### 🔗 Related Issues

> close #xxxx

### 💡 Background and Solution

> - What problem does this PR solve? Include the error message and reproduction steps when relevant.
> - What is the root cause, and why is this the right fix?
> - For UI / interaction changes, add before/after screenshots or a GIF.

### 🧪 Verification

> Paste the commands you ran and the result. Remove the items that do not apply.

- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm build`
- [ ] `pnpm verify:imports` (dependency tree / import map changes only)
- [ ] Browser check (note the antdv-next version, `resolver` mode and CDN used, and the result)

### ✅ Checklist

- [ ] The branch is based on `main` and targets `main`.
- [ ] No unrelated changes, debug code, or local-only files are included.
- [ ] If the antdv-next dependency tree changed, `src/utils/esm-packages.ts` was regenerated with `pnpm gen:imports`.
- [ ] When affected: switching antdv-next versions (`latest` and older ones), `?resolver=esm.sh|legacy`, and share links still work.
- [ ] Public behavior or workflow changes are reflected in `README.md` / `README.zh-CN.md` when needed.
