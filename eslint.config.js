import { sxzz } from '@sxzz/eslint-config'
export default [
  ...(await sxzz()),
  // src/template 是含占位符的生成源(如 #X_IMPORT#),不是合法 JS/TS
  {
    ignores: ['src/template/**'],
  },
  { rules: { 'baseline-js/use-baseline': 'off' } },
]
