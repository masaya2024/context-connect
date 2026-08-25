<script setup lang="ts">
const sources = [
  {
    name: 'GitHub',
    description: 'Pull Request, Commit, Review, changed files',
    status: 'connected',
    scope: '3 repositories',
    secret: '•••• 8d2a',
  },
  {
    name: 'Notion',
    description: 'Task databases, pages and block content',
    status: 'connected',
    scope: '2 data sources',
    secret: '•••• 31fc',
  },
  {
    name: 'CSV',
    description: 'UTF-8 task history with stable upsert IDs',
    status: 'ready',
    scope: 'Manual import',
    secret: 'Not required',
  },
  {
    name: 'Markdown',
    description: 'ADR, README and design documents',
    status: 'ready',
    scope: 'Manual import',
    secret: 'Not required',
  },
]
</script>

<template>
  <div>
    <PageHeading
      eyebrow="Connectors"
      title="Sources"
      description="収集対象とscopeを管理します。Secret値は一度も再表示されません。"
    >
      <button class="focus-ring bg-ink rounded-xl px-4 py-2.5 text-sm font-semibold text-white">
        Sourceを追加
      </button>
    </PageHeading>
    <section class="grid gap-4 lg:grid-cols-2">
      <article
        v-for="source in sources"
        :key="source.name"
        class="border-sand bg-panel rounded-2xl border p-6"
      >
        <div class="flex items-start justify-between gap-5">
          <div>
            <div class="flex items-center gap-3">
              <h3 class="text-xl font-semibold">{{ source.name }}</h3>
              <StatusBadge :status="source.status" />
            </div>
            <p class="mt-2 text-sm leading-6 text-black/50">{{ source.description }}</p>
          </div>
          <button
            class="focus-ring border-sand rounded-lg border px-3 py-1.5 text-xs font-semibold"
          >
            管理
          </button>
        </div>
        <dl class="mt-5 grid grid-cols-2 gap-3 rounded-xl bg-black/[.025] p-4 text-sm">
          <div>
            <dt class="text-xs text-black/40">Scope</dt>
            <dd class="mt-1 font-semibold">{{ source.scope }}</dd>
          </div>
          <div>
            <dt class="text-xs text-black/40">Credential</dt>
            <dd class="mt-1 font-mono text-xs">{{ source.secret }}</dd>
          </div>
        </dl>
      </article>
    </section>
  </div>
</template>
