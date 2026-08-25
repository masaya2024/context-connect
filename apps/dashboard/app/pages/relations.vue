<script setup lang="ts">
const candidates = reactive([
  {
    id: 'rel-201',
    task: '暗証番号再設定フロー',
    pr: '#1811 ロック制御を修正',
    confidence: 0.91,
    status: 'candidate',
    evidence: ['title 30/30', 'date 18/20', 'author 20/20', 'repository 15/15', 'diff 8/10'],
  },
  {
    id: 'rel-202',
    task: '請求CSV出力の改善',
    pr: '#1760 invoice export',
    confidence: 0.78,
    status: 'candidate',
    evidence: ['title 24/30', 'date 14/20', 'repository 15/15', 'diff 10/10'],
  },
])

const decide = async (
  relation: (typeof candidates)[number],
  decision: 'confirmed' | 'rejected',
) => {
  const previous = relation.status
  relation.status = decision
  try {
    const { request } = useContextApi()
    await request(`/relations/${relation.id}`, { method: 'PATCH', body: { status: decision } })
  } catch {
    relation.status = previous
  }
}
</script>

<template>
  <div>
    <PageHeading
      eyebrow="Human in the loop"
      title="Relation candidates"
      description="推定Relationの根拠を確認し、確定・却下できます。明示リンクは常に推定より優先されます。"
    />
    <section class="space-y-4">
      <article
        v-for="candidate in candidates"
        :key="candidate.id"
        class="border-sand bg-panel rounded-2xl border p-6"
      >
        <div class="flex flex-col justify-between gap-5 lg:flex-row lg:items-start">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <StatusBadge :status="candidate.status" /><span class="text-sm font-semibold"
                >{{ Math.round(candidate.confidence * 100) }}% confidence</span
              >
            </div>
            <div class="mt-4 flex flex-col gap-2 text-sm sm:flex-row sm:items-center">
              <span class="bg-moss-light rounded-lg px-3 py-2 font-semibold">{{
                candidate.task
              }}</span
              ><span class="text-coral text-xl">↗</span
              ><span class="rounded-lg bg-black/5 px-3 py-2 font-semibold">{{ candidate.pr }}</span>
            </div>
            <div class="mt-4 flex flex-wrap gap-2">
              <span
                v-for="signal in candidate.evidence"
                :key="signal"
                class="rounded-full bg-black/[.035] px-2.5 py-1 text-xs text-black/55"
                >{{ signal }}</span
              >
            </div>
          </div>
          <div v-if="candidate.status === 'candidate'" class="flex gap-2">
            <button
              class="focus-ring rounded-xl border border-red-200 px-4 py-2 text-sm font-semibold text-red-700"
              @click="decide(candidate, 'rejected')"
            >
              Reject
            </button>
            <button
              class="focus-ring bg-moss rounded-xl px-4 py-2 text-sm font-semibold text-white"
              @click="decide(candidate, 'confirmed')"
            >
              Confirm
            </button>
          </div>
        </div>
      </article>
    </section>
  </div>
</template>
