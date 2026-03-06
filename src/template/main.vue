<script setup>
import { theme } from 'antdv-next'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { setupAntdvNext } from './antdv-next.js'
import App from './App.vue'
setupAntdvNext()

const { darkAlgorithm, defaultAlgorithm } = theme
const isDark = ref(document.documentElement.classList.contains('dark'))

const themeConfig = computed(() => ({
  algorithm: isDark.value ? darkAlgorithm : defaultAlgorithm,
}))

let observer
onMounted(() => {
  observer = new MutationObserver(() => {
    isDark.value = document.documentElement.classList.contains('dark')
  })
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  })
})
onUnmounted(() => observer?.disconnect())
</script>

<template>
  <a-config-provider :theme="themeConfig">
    <App />
  </a-config-provider>
</template>
