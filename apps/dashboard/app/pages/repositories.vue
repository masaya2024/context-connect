<script setup lang="ts">
const repositories = reactive([
  { name: 'acme/storage-api', selected: true, project: 'Storage', sync: 'Webhook + 30m' },
  { name: 'acme/corporate-web', selected: true, project: 'Corporate Web', sync: 'Webhook + 30m' },
  { name: 'acme/internal-tools', selected: false, project: '—', sync: 'Off' },
])
</script>

<template>
  <div>
    <PageHeading
      eyebrow="GitHub scope"
      title="Repositories"
      description="RepositoryをProjectへ明示的に割り当て、検索ACLと推定Relationの境界に使います。"
    />
    <div class="border-sand bg-panel overflow-hidden rounded-2xl border">
      <table class="w-full text-left text-sm">
        <thead class="bg-black/[.025] text-xs tracking-wide text-black/45 uppercase">
          <tr>
            <th class="px-5 py-4">Sync</th>
            <th class="px-5 py-4">Repository</th>
            <th class="px-5 py-4">Project</th>
            <th class="px-5 py-4">Schedule</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-black/7">
          <tr v-for="repo in repositories" :key="repo.name">
            <td class="px-5 py-4">
              <input
                v-model="repo.selected"
                type="checkbox"
                :aria-label="`${repo.name}を同期`"
                class="accent-moss h-4 w-4"
              />
            </td>
            <td class="px-5 py-4 font-mono text-xs font-semibold">{{ repo.name }}</td>
            <td class="px-5 py-4">{{ repo.project }}</td>
            <td class="px-5 py-4 text-black/50">{{ repo.sync }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
