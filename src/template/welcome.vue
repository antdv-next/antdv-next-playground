<script setup lang="ts">
import { ProConfigProvider, Scrollbar } from '@antdv-next/pro'
import { version as antdvVersion } from 'antdv-next'
import { ref, version as vueVersion } from 'vue'

const msg = ref('Hello World!')
</script>

<template>
  <ProConfigProvider>
    <h1>{{ msg }}</h1>
    <a-input v-model:value="msg" />

    <Scrollbar style="height: 120px; border: 1px dashed #1677ff; padding: 8px">
      <p v-for="i in 20" :key="i">Line {{ i }} — pro Scrollbar</p>
    </Scrollbar>

    <p>Antdv Next {{ antdvVersion }} + Vue {{ vueVersion }}</p>
  </ProConfigProvider>
</template>
