<script setup lang="ts">
const query = ref('')
const searching = ref(false)
const results = ref([
  {
    id: 'task-142',
    type: 'task',
    title: '暗証番号再設定時のロック制御',
    source: 'Notion',
    project: 'Storage',
    score: 0.96,
    url: '#',
  },
  {
    id: 'pr-1842',
    type: 'pull_request',
    title: '請求処理の指数バックオフを追加',
    source: 'GitHub',
    project: 'Storage',
    score: 0.91,
    url: '#',
  },
  {
    id: 'adr-019',
    type: 'document',
    title: '認証境界とdefault deny',
    source: 'Markdown',
    project: 'Platform',
    score: 0.83,
    url: '#',
  },
])

const search = async () => {
  searching.value = true
  try {
    const { request } = useContextApi()
    const response = await request<typeof results.value>('/documents', {
      query: { query: query.value, limit: 20 },
    })
    results.value = response.data
  } catch {
    // The seeded preview remains visible when the local API is not running.
  } finally {
    searching.value = false
  }
}
</script>

<template>
  <div>
    <PageHeading
      eyebrow="Hybrid retrieval"
      title="Knowledge"
      description="Task、PR、Review、設計資料を横断し、exact・keyword・semantic・relationを組み合わせて検索します。"
    />
    <form class="border-sand bg-panel flex gap-3 rounded-2xl border p-3" @submit.prevent="search">
      <label class="sr-only" for="knowledge-query">Knowledgeを検索</label>
      <input
        id="knowledge-query"
        v-model="query"
        class="focus-ring min-w-0 flex-1 rounded-xl bg-transparent px-3 py-2"
        placeholder="例: 暗証番号の変更理由、請求処理の過去障害"
      />
      <button class="focus-ring bg-ink rounded-xl px-5 py-2.5 text-sm font-semibold text-white">
        {{ searching ? '検索中…' : '検索' }}
      </button>
    </form>
    <div class="mt-4 flex flex-wrap gap-2 text-xs">
      <button
        v-for="filter in [
          'All types',
          'Task',
          'Pull Request',
          'Review',
          'Document',
          'Last 90 days',
        ]"
        :key="filter"
        class="border-sand bg-panel rounded-full border px-3 py-1.5 hover:border-black/30"
      >
        {{ filter }}
      </button>
    </div>
    <section class="mt-6 space-y-3" aria-live="polite">
      <article
        v-for="result in results"
        :key="result.id"
        class="border-sand bg-panel rounded-2xl border p-5 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/5"
      >
        <div class="flex items-start justify-between gap-5">
          <div>
            <div class="flex items-center gap-2 text-xs text-black/45">
              <span class="bg-moss-light text-moss rounded-md px-2 py-1 font-semibold">{{
                result.type
              }}</span
              ><span>{{ result.source }} · {{ result.project }}</span>
            </div>
            <h3 class="mt-3 text-lg font-semibold">
              <a :href="result.url" class="hover:text-moss">{{ result.title }}</a>
            </h3>
            <p class="mt-2 font-mono text-xs text-black/40">{{ result.id }}</p>
          </div>
          <div class="text-right">
            <p class="text-moss text-lg font-semibold">{{ Math.round(result.score * 100) }}%</p>
            <p class="text-xs text-black/35">relevance</p>
          </div>
        </div>
      </article>
    </section>
  </div>
</template>
