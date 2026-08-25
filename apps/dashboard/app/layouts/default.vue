<script setup lang="ts">
const route = useRoute()

const navigation = [
  { label: 'Overview', path: '/', icon: '◫' },
  { label: 'Setup', path: '/setup', icon: '◇' },
  { label: 'Sources', path: '/sources', icon: '⇄' },
  { label: 'Repositories', path: '/repositories', icon: '⌘' },
  { label: 'Knowledge', path: '/knowledge', icon: '⌕' },
  { label: 'Relations', path: '/relations', icon: '↗' },
  { label: 'Sync', path: '/sync', icon: '↻' },
  { label: 'Members', path: '/members', icon: '◎' },
  { label: 'MCP', path: '/mcp', icon: '⟷' },
  { label: 'Audit', path: '/audit', icon: '▤' },
  { label: 'System', path: '/system', icon: '⚙' },
]
</script>

<template>
  <div class="min-h-screen lg:grid lg:grid-cols-[248px_1fr]">
    <aside class="border-sand bg-ink text-panel border-r px-5 py-7 lg:min-h-screen">
      <div class="mb-9 flex items-center gap-3 px-2">
        <div class="bg-coral grid h-10 w-10 place-items-center rounded-xl font-black text-white">
          C
        </div>
        <div>
          <p class="text-lg font-semibold tracking-tight">Context Connect</p>
          <p class="text-xs text-white/55">Engineering Context</p>
        </div>
      </div>

      <nav
        aria-label="Main navigation"
        class="grid grid-cols-2 gap-1 sm:grid-cols-4 lg:grid-cols-1"
      >
        <NuxtLink
          v-for="item in navigation"
          :key="item.path"
          :to="item.path"
          class="focus-ring flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-white/65 hover:bg-white/8 hover:text-white"
          :class="{ 'bg-white/12 !text-white': route.path === item.path }"
        >
          <span class="w-5 text-center text-base" aria-hidden="true">{{ item.icon }}</span>
          {{ item.label }}
        </NuxtLink>
      </nav>

      <div class="mt-10 hidden rounded-2xl border border-white/10 bg-white/5 p-4 lg:block">
        <p class="text-xs font-medium text-white/55">Data plane</p>
        <p class="mt-1 text-sm font-semibold">demo-company</p>
        <div class="mt-3 flex items-center gap-2 text-xs text-emerald-300">
          <span class="h-2 w-2 rounded-full bg-emerald-400" /> Customer-owned
        </div>
      </div>
    </aside>

    <main class="min-w-0 px-5 py-7 sm:px-8 lg:px-12 lg:py-10">
      <header class="mb-9 flex items-center justify-between">
        <div>
          <p class="text-moss text-xs font-bold tracking-[0.18em] uppercase">Workspace</p>
          <h1 class="mt-1 text-xl font-semibold">Engineering</h1>
        </div>
        <div class="flex items-center gap-3">
          <div class="text-right">
            <p class="text-sm font-semibold">Demo Admin</p>
            <p class="text-xs text-black/45">Owner</p>
          </div>
          <div
            class="bg-moss-light text-moss grid h-10 w-10 place-items-center rounded-full font-bold"
          >
            DA
          </div>
        </div>
      </header>
      <slot />
    </main>
  </div>
</template>
