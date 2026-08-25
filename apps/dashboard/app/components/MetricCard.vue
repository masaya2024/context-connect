<script setup lang="ts">
defineProps<{ label: string; value: string | number; detail: string; tone?: 'moss' | 'coral' }>()
</script>

<template>
  <article
    class="border-sand bg-panel rounded-2xl border p-5 shadow-[0_16px_40px_rgba(28,42,39,.04)]"
  >
    <div class="flex items-start justify-between gap-3">
      <div>
        <p class="text-xs font-semibold tracking-wide text-black/45 uppercase">{{ label }}</p>
        <p class="mt-3 text-3xl font-semibold tracking-tight">{{ value }}</p>
      </div>
      <span class="mt-1 h-3 w-3 rounded-full" :class="tone === 'coral' ? 'bg-coral' : 'bg-moss'" />
    </div>
    <p class="mt-3 text-xs text-black/45">{{ detail }}</p>
  </article>
</template>
