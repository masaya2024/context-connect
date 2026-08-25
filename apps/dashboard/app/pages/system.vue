<script setup lang="ts">
const resources = [
  { name: 'D1', binding: 'DB', status: 'connected', usage: '128 MB' },
  { name: 'R2', binding: 'RAW_BUCKET', status: 'connected', usage: '2.4 GB' },
  { name: 'Vectorize', binding: 'VECTOR_INDEX', status: 'connected', usage: '48,209 vectors' },
  { name: 'Queues', binding: 'SYNC_QUEUE', status: 'connected', usage: '0 backlog' },
  { name: 'Workers AI', binding: 'AI', status: 'connected', usage: 'bge-m3 · 1024d' },
]
</script>

<template>
  <div>
    <PageHeading
      eyebrow="Operations"
      title="System"
      description="アプリとschemaのversionを別管理し、binding、migration、再構築可能性を確認します。"
    >
      <button
        class="focus-ring border-coral text-coral rounded-xl border px-4 py-2.5 text-sm font-semibold"
      >
        Vector indexを再構築
      </button>
    </PageHeading>
    <section class="grid gap-4 sm:grid-cols-3">
      <MetricCard label="App version" value="0.1.0" detail="Customer data plane" />
      <MetricCard label="Schema version" value="0001" detail="All migrations applied" />
      <MetricCard label="Availability" value="99.97%" detail="Last 30 days" tone="coral" />
    </section>
    <section class="border-sand bg-panel mt-6 rounded-2xl border p-6">
      <h3 class="text-lg font-semibold">Cloudflare bindings</h3>
      <ul class="mt-4 divide-y divide-black/7">
        <li
          v-for="resource in resources"
          :key="resource.name"
          class="grid gap-2 py-4 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-center"
        >
          <p class="font-semibold">{{ resource.name }}</p>
          <code class="text-xs">{{ resource.binding }}</code>
          <p class="text-sm text-black/50">{{ resource.usage }}</p>
          <StatusBadge :status="resource.status" />
        </li>
      </ul>
    </section>
    <section class="mt-6 rounded-2xl border border-red-200 bg-red-50 p-6">
      <h3 class="font-semibold text-red-900">Danger zone</h3>
      <p class="mt-1 text-sm text-red-800/70">
        Data purgeとConnector解除には対象名の再入力による二段階確認が必要です。
      </p>
      <button
        class="focus-ring mt-4 rounded-xl border border-red-300 px-4 py-2 text-sm font-semibold text-red-800"
      >
        Purge controls
      </button>
    </section>
  </div>
</template>
