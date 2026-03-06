<script setup lang="ts">
import { version as antdvVersion } from 'antdv-next'
import { ref, version as vueVersion } from 'vue'

const msg = ref('Hello World!')
</script>

<template>
  <h1>{{ msg }}</h1>
  <a-input v-model:value="msg" />

  <p>Antdv Next {{ antdvVersion }} + Vue {{ vueVersion }}</p>
</template>
