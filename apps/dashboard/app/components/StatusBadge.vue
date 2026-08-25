<script setup lang="ts">
const props = defineProps<{ status: string }>()
const styles: Record<string, string> = {
  succeeded: 'bg-emerald-100 text-emerald-800',
  connected: 'bg-emerald-100 text-emerald-800',
  running: 'bg-blue-100 text-blue-800',
  queued: 'bg-amber-100 text-amber-800',
  partial: 'bg-orange-100 text-orange-800',
  candidate: 'bg-violet-100 text-violet-800',
  confirmed: 'bg-emerald-100 text-emerald-800',
  failed: 'bg-red-100 text-red-800',
  rejected: 'bg-zinc-200 text-zinc-700',
}
</script>

<template>
  <span
    class="inline-flex rounded-full px-2.5 py-1 text-xs font-semibold"
    :class="styles[props.status] ?? 'bg-zinc-100 text-zinc-700'"
  >
    {{ props.status }}
  </span>
</template>
