<script setup lang="ts">
const jobs = reactive([
  {
    id: 'job-9081',
    source: 'GitHub · storage-api',
    status: 'succeeded',
    fetched: 42,
    failed: 0,
    reason: '',
    attempt: 1,
    created: '3分前',
  },
  {
    id: 'job-9080',
    source: 'Notion · Engineering Tasks',
    status: 'running',
    fetched: 118,
    failed: 0,
    reason: '',
    attempt: 1,
    created: '5分前',
  },
  {
    id: 'job-9079',
    source: 'CSV · legacy-2024',
    status: 'partial',
    fetched: 824,
    failed: 3,
    reason: '3行でcreated_atが不正です',
    attempt: 1,
    created: '18分前',
  },
  {
    id: 'job-9078',
    source: 'GitHub · corporate-web',
    status: 'failed',
    fetched: 0,
    failed: 1,
    reason: 'GitHub API rate limit exceeded',
    attempt: 4,
    created: '1時間前',
  },
])

const retry = async (job: (typeof jobs)[number]) => {
  const previous = job.status
  job.status = 'queued'
  try {
    const { request } = useContextApi()
    await request('/sync-jobs', { method: 'POST', body: { retry_job_id: job.id } })
  } catch {
    job.status = previous
  }
}
</script>

<template>
  <div>
    <PageHeading
      eyebrow="Ingestion pipeline"
      title="Sync jobs"
      description="source object、失敗理由、retry回数を追跡します。再実行は同じ冪等性キーを使い重複を作りません。"
    >
      <button class="focus-ring bg-ink rounded-xl px-4 py-2.5 text-sm font-semibold text-white">
        Manual sync
      </button>
    </PageHeading>
    <div class="border-sand bg-panel overflow-x-auto rounded-2xl border">
      <table class="w-full min-w-[820px] text-left text-sm">
        <thead class="bg-black/[.025] text-xs tracking-wide text-black/45 uppercase">
          <tr>
            <th class="px-5 py-4">Job</th>
            <th class="px-5 py-4">Source</th>
            <th class="px-5 py-4">Status</th>
            <th class="px-5 py-4">Progress</th>
            <th class="px-5 py-4">Reason</th>
            <th class="px-5 py-4" />
          </tr>
        </thead>
        <tbody class="divide-y divide-black/7">
          <tr v-for="job in jobs" :key="job.id">
            <td class="px-5 py-4">
              <p class="font-mono text-xs font-semibold">{{ job.id }}</p>
              <p class="text-xs text-black/40">{{ job.created }} · try {{ job.attempt }}</p>
            </td>
            <td class="px-5 py-4 font-semibold">{{ job.source }}</td>
            <td class="px-5 py-4"><StatusBadge :status="job.status" /></td>
            <td class="px-5 py-4">
              {{ job.fetched }} fetched<span v-if="job.failed" class="text-red-700">
                · {{ job.failed }} failed</span
              >
            </td>
            <td class="max-w-xs px-5 py-4 text-xs text-black/50">{{ job.reason || '—' }}</td>
            <td class="px-5 py-4">
              <button
                v-if="['failed', 'partial'].includes(job.status)"
                class="text-moss text-xs font-bold hover:underline"
                @click="retry(job)"
              >
                Retry
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
