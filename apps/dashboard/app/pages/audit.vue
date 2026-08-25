<script setup lang="ts">
const events = [
  {
    at: '2026-08-25 12:42:19',
    actor: 'aiko@example.com',
    action: 'relation.confirm',
    target: 'rel-201',
    request: 'req_7de3',
  },
  {
    at: '2026-08-25 12:38:02',
    actor: 'system',
    action: 'sync.completed',
    target: 'job-9081',
    request: 'req_72ac',
  },
  {
    at: '2026-08-25 11:51:44',
    actor: 'admin@example.com',
    action: 'source.scope.update',
    target: 'github/storage-api',
    request: 'req_6f91',
  },
  {
    at: '2026-08-25 09:03:11',
    actor: 'admin@example.com',
    action: 'mcp.token.issue',
    target: 'client_42',
    request: 'req_559d',
  },
]
</script>

<template>
  <div>
    <PageHeading
      eyebrow="Auditability"
      title="Audit log"
      description="認証、Connector、ACL、Relation、purge、re-index、migrationの管理イベントをrequest_id付きで記録します。"
    />
    <div class="border-sand bg-panel overflow-x-auto rounded-2xl border">
      <table class="w-full min-w-[760px] text-left text-sm">
        <thead class="bg-black/[.025] text-xs tracking-wide text-black/45 uppercase">
          <tr>
            <th class="px-5 py-4">Time</th>
            <th class="px-5 py-4">Actor</th>
            <th class="px-5 py-4">Action</th>
            <th class="px-5 py-4">Target</th>
            <th class="px-5 py-4">Request</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-black/7">
          <tr v-for="event in events" :key="event.request">
            <td class="px-5 py-4 font-mono text-xs text-black/50">{{ event.at }}</td>
            <td class="px-5 py-4">{{ event.actor }}</td>
            <td class="px-5 py-4 font-semibold">{{ event.action }}</td>
            <td class="px-5 py-4 font-mono text-xs">{{ event.target }}</td>
            <td class="px-5 py-4 font-mono text-xs text-black/45">{{ event.request }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
