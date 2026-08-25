<script setup lang="ts">
defineProps<{ eyebrow?: string; title: string; description: string }>()
</script>

<template>
  <div class="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
    <div class="max-w-3xl">
      <p v-if="eyebrow" class="text-coral text-xs font-bold tracking-[0.18em] uppercase">
        {{ eyebrow }}
      </p>
      <h2 class="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">{{ title }}</h2>
      <p class="mt-2 text-sm leading-6 text-black/55">{{ description }}</p>
    </div>
    <slot />
  </div>
</template>
