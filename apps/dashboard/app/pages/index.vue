<script setup lang="ts">
const stats = [
  { label: 'Searchable knowledge', value: '12,846', detail: 'Tasks, PRs, reviews and documents' },
  { label: 'Explicit relations', value: '2,309', detail: 'Verified Task ↔ PR links' },
  { label: 'Index freshness', value: '3m', detail: 'Newest source update', tone: 'coral' as const },
  { label: 'Zero-hit rate', value: '4.8%', detail: 'Last 7 days · down 1.2%' },
]

const activities = [
  { source: 'GitHub', item: 'PR #1842: 請求処理の再試行制御', status: 'succeeded', time: '2分前' },
  { source: 'Notion', item: '暗証番号再設定フロー', status: 'succeeded', time: '4分前' },
  { source: 'CSV', item: 'legacy-tasks-2024.csv', status: 'partial', time: '18分前' },
]
</script>

<template>
  <div>
    <PageHeading
      eyebrow="Knowledge overview"
      title="検索できる文脈を、ひと目で。"
      description="同期件数ではなく、AIが実際に辿れるKnowledge・Relation・Index freshnessを表示しています。"
    >
      <NuxtLink
        to="/knowledge"
        class="focus-ring bg-ink hover:bg-moss rounded-xl px-4 py-2.5 text-sm font-semibold text-white"
      >
        Knowledgeを検索
      </NuxtLink>
    </PageHeading>

    <section class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard v-for="stat in stats" :key="stat.label" v-bind="stat" />
    </section>

    <section class="mt-7 grid gap-6 xl:grid-cols-[1.45fr_1fr]">
      <article class="border-sand bg-panel overflow-hidden rounded-2xl border">
        <div class="flex items-center justify-between border-b border-black/7 px-5 py-4">
          <div>
            <h3 class="font-semibold">Recent ingestion</h3>
            <p class="mt-0.5 text-xs text-black/45">Connectorから検索Indexまで</p>
          </div>
          <NuxtLink to="/sync" class="text-moss text-sm font-semibold hover:underline"
            >すべて見る</NuxtLink
          >
        </div>
        <ul class="divide-y divide-black/7">
          <li
            v-for="activity in activities"
            :key="activity.item"
            class="flex items-center gap-4 px-5 py-4"
          >
            <div
              class="bg-moss-light text-moss grid h-10 w-10 shrink-0 place-items-center rounded-xl text-xs font-bold"
            >
              {{ activity.source.slice(0, 2).toUpperCase() }}
            </div>
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-semibold">{{ activity.item }}</p>
              <p class="text-xs text-black/45">{{ activity.source }} · {{ activity.time }}</p>
            </div>
            <StatusBadge :status="activity.status" />
          </li>
        </ul>
      </article>

      <article class="bg-moss relative overflow-hidden rounded-2xl p-6 text-white">
        <div
          class="absolute -right-12 -bottom-16 h-48 w-48 rounded-full border-[32px] border-white/5"
        />
        <p class="text-xs font-bold tracking-[.18em] text-white/55 uppercase">MCP status</p>
        <h3 class="mt-3 text-2xl font-semibold">AI Clientへ接続済み</h3>
        <p class="mt-2 max-w-sm text-sm leading-6 text-white/65">
          8つのread-only toolが、現在のPrincipalとProject ACLを使ってKnowledgeを返します。
        </p>
        <div class="mt-7 flex items-center gap-2 text-sm">
          <span class="h-2.5 w-2.5 rounded-full bg-emerald-300" />
          <span>Streamable HTTP healthy</span>
        </div>
        <NuxtLink
          to="/mcp"
          class="mt-5 inline-block text-sm font-semibold underline underline-offset-4"
        >
          接続設定を開く
        </NuxtLink>
      </article>
    </section>
  </div>
</template>
