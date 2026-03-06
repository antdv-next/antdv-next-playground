import Antd from 'antdv-next'
import { createApp } from 'vue'
import App from '@/App.vue'
import '@unocss/reset/tailwind.css'
import '@vue/repl/style.css'
import 'antdv-next/dist/reset.css'
import 'antdv-next/dist/antd.css'
import 'uno.css'

// @ts-expect-error Custom window property
globalThis.VUE_DEVTOOLS_CONFIG = {
  defaultSelectedAppId: 'repl',
}

createApp(App).use(Antd).mount('#app')
