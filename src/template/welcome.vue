<script setup lang="ts">
import { version as antdvVersion } from 'antdv-next'
import { ref, version as vueVersion } from 'vue'

const msg = ref('Hello World!')
</script>

<template>
  <div style="max-width: 480px; margin: 48px auto">
    <h1>{{ msg }}</h1>
    <a-input v-model:value="msg" style="width: 240px" />
    <a-button
      type="primary"
      style="margin-left: 8px"
      @click="msg = 'Hello Antdv Next!'"
    >
      Reset
    </a-button>

    <p>Antdv Next {{ antdvVersion }} + Vue {{ vueVersion }}</p>
    <p>
      Pro / X are off by default — enable them in Settings, or open a link with
      <code>?pro=1&amp;x=1</code>
    </p>
  </div>
</template>
