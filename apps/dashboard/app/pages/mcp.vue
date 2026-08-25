<script setup lang="ts">
const copied = ref(false)
const endpoint = computed(
  () => `${useRuntimeConfig().public.apiBase.replace(/\/api\/v1\/?$/, '')}/mcp`,
)
const tools = [
  'search_knowledge',
  'search_tasks',
  'get_task',
  'search_pull_requests',
  'get_pull_request',
  'find_related_history',
  'get_change_history',
  'get_project_context',
]

const copyEndpoint = async () => {
  await navigator.clipboard.writeText(endpoint.value)
  copied.value = true
  setTimeout(() => (copied.value = false), 1800)
}
</script>

<template>
  <div>
    <PageHeading
      eyebrow="Remote MCP"
      title="AI Client connection"
      description="OAuth 2.1で認証したPrincipalのscopeとProject ACLを、すべてのread-only toolへ適用します。"
    />
    <section class="grid gap-6 xl:grid-cols-[1.2fr_.8fr]">
      <article class="border-sand bg-panel rounded-2xl border p-6">
        <div class="flex items-center gap-2">
          <span class="h-2.5 w-2.5 rounded-full bg-emerald-500" /><span
            class="text-sm font-semibold"
            >Streamable HTTP healthy</span
          >
        </div>
        <label class="mt-6 block text-xs font-semibold tracking-wide text-black/45 uppercase"
          >Endpoint</label
        >
        <div class="border-sand mt-2 flex items-center gap-2 rounded-xl border bg-white p-2">
          <code class="min-w-0 flex-1 truncate px-2 text-xs">{{ endpoint }}</code>
          <button
            class="focus-ring bg-ink rounded-lg px-3 py-2 text-xs font-semibold text-white"
            @click="copyEndpoint"
          >
            {{ copied ? 'Copied' : 'Copy' }}
          </button>
        </div>
        <div class="bg-moss-light mt-5 rounded-xl p-4 text-sm leading-6">
          Claude/Codex側のAI契約と認証情報はContext Connectへ渡りません。ここではKnowledgeへのOAuth
          scopeだけを認可します。
        </div>
      </article>
      <article class="bg-ink rounded-2xl p-6 text-white">
        <p class="text-xs font-bold tracking-[.15em] text-white/45 uppercase">Available tools</p>
        <ul class="mt-4 space-y-2 font-mono text-xs text-white/75">
          <li v-for="tool in tools" :key="tool" class="rounded-lg bg-white/6 px-3 py-2">
            {{ tool }}
          </li>
        </ul>
      </article>
    </section>
  </div>
</template>
