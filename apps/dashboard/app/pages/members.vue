<script setup lang="ts">
const members = [
  {
    name: 'Demo Admin',
    email: 'admin@example.com',
    role: 'Owner',
    projects: 'All projects',
    status: 'Active',
  },
  {
    name: 'Aiko Tanaka',
    email: 'aiko@example.com',
    role: 'Developer',
    projects: 'Storage, Platform',
    status: 'Active',
  },
  {
    name: 'Ken Sato',
    email: 'ken@example.com',
    role: 'Viewer',
    projects: 'Corporate Web',
    status: 'Invited',
  },
]
</script>

<template>
  <div>
    <PageHeading
      eyebrow="RBAC & ACL"
      title="Members"
      description="Roleは操作権限、Project ACLは検索可能なKnowledgeの境界としてdefault denyで適用されます。"
    >
      <button class="focus-ring bg-ink rounded-xl px-4 py-2.5 text-sm font-semibold text-white">
        メンバーを招待
      </button>
    </PageHeading>
    <div class="border-sand bg-panel overflow-hidden rounded-2xl border">
      <ul class="divide-y divide-black/7">
        <li
          v-for="member in members"
          :key="member.email"
          class="grid gap-3 px-5 py-4 sm:grid-cols-[1.3fr_.7fr_1fr_auto] sm:items-center"
        >
          <div>
            <p class="font-semibold">{{ member.name }}</p>
            <p class="text-xs text-black/45">{{ member.email }}</p>
          </div>
          <div>
            <p class="text-xs text-black/40">Role</p>
            <p class="text-sm font-semibold">{{ member.role }}</p>
          </div>
          <div>
            <p class="text-xs text-black/40">Project access</p>
            <p class="text-sm">{{ member.projects }}</p>
          </div>
          <button
            class="focus-ring border-sand rounded-lg border px-3 py-1.5 text-xs font-semibold"
          >
            編集
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>
