<script setup lang="ts">
import {
  cdn,
  getSupportedAntdvVersions,
  getSupportedProVersions,
  getSupportedTSVersions,
  getSupportedVueVersions,
  getSupportedXVersions,
} from '@/utils/dependency'
import type { Store, VersionKey } from '@/composables/store'
import type { Ref } from 'vue'

const props = defineProps<{
  store: Store
}>()
const open = defineModel<boolean>('open', { default: false })

const cdnOptions = [
  { label: 'jsDelivr', value: 'jsdelivr' },
  { label: 'jsDelivr Fastly', value: 'jsdelivr-fastly' },
  { label: 'JSDMirror (国内镜像)', value: 'jsdelivr-jsdmirror' },
  { label: 'Gcore', value: 'jsdelivr-gcore' },
  { label: 'unpkg', value: 'unpkg' },
]

interface Version {
  text: string
  published: Ref<string[]>
  active: string
  hint?: string
  /** 存在则该版本可被开关启用/禁用(pro / x) */
  toggleKey?: 'pro' | 'x'
}

const versions = reactive<Record<VersionKey, Version>>({
  antdvNext: {
    text: 'Antdv Next',
    published: getSupportedAntdvVersions(),
    active: props.store.versions.antdvNext,
  },
  vue: {
    text: 'Vue',
    published: getSupportedVueVersions(),
    active: props.store.versions.vue,
    hint: 'Antdv Next requires Vue >= 3.5.0',
  },
  typescript: {
    text: 'TypeScript',
    published: getSupportedTSVersions(),
    active: props.store.versions.typescript,
  },
  pro: {
    text: 'Pro',
    published: getSupportedProVersions(),
    active: props.store.versions.pro,
    hint: 'Requires Antdv Next >= 1.3.0',
    toggleKey: 'pro',
  },
  x: {
    text: 'X',
    published: getSupportedXVersions(),
    active: props.store.versions.x,
    hint: 'Requires Antdv Next >= 1.2.0',
    toggleKey: 'x',
  },
})

const toggles: Record<'pro' | 'x', WritableComputedRef<boolean>> = {
  pro: computed({
    get: () => props.store.featureFlags.pro,
    set: (v: boolean) => props.store.setFeature('pro', v),
  }),
  x: computed({
    get: () => props.store.featureFlags.x,
    set: (v: boolean) => props.store.setFeature('x', v),
  }),
}

async function setVersion(key: VersionKey, v: string) {
  versions[key].active = `loading...`
  await props.store.setVersion(key, v)
  versions[key].active = v
}
</script>

<template>
  <a-modal v-model:open="open" title="Settings" :width="480" :footer="null">
    <a-form layout="vertical">
      <a-form-item label="CDN">
        <a-select v-model:value="cdn" :options="cdnOptions" />
      </a-form-item>

      <a-divider plain>Versions</a-divider>

      <div
        v-for="(v, key) of versions"
        :key="key"
        mb-3
        flex="~ gap-4"
        items-center
      >
        <span flex="~ gap-1" w-110px shrink-0 items-center>
          {{ v.text }}
          <a-tooltip v-if="v.hint" :title="v.hint" placement="bottom">
            <span
              i-ri-information-line
              inline-block
              h-14px
              w-14px
              cursor-help
              op-50
            />
          </a-tooltip>
        </span>
        <a-select
          :value="v.active"
          show-search
          size="small"
          style="width: 180px"
          :disabled="v.toggleKey ? !toggles[v.toggleKey].value : false"
          :options="
            v.published.map((ver: string) => ({ label: ver, value: ver }))
          "
          @change="setVersion(key, $event as string)"
        />
        <a-switch
          v-if="v.toggleKey"
          :checked="toggles[v.toggleKey].value"
          size="small"
          :disabled="!!store.pr"
          :title="store.pr ? 'PR preview mode disables Pro/X' : undefined"
          @update:checked="
            (checked) => (toggles[v.toggleKey!].value = !!checked)
          "
        />
      </div>
    </a-form>
  </a-modal>
</template>
