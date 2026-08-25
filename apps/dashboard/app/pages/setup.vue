<script setup lang="ts">
const form = reactive({
  tenantName: '',
  tenantSlug: '',
  workspaceName: 'Engineering',
  adminEmail: '',
})
const state = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')

const submit = async () => {
  state.value = 'saving'
  try {
    const { request } = useContextApi()
    await request('/setup', { method: 'POST', body: form })
    state.value = 'saved'
  } catch {
    state.value = 'error'
  }
}
</script>

<template>
  <div class="max-w-3xl">
    <PageHeading
      eyebrow="Step 1 of 4"
      title="Customer-owned data planeを初期設定"
      description="Tenantと最初のWorkspaceを作成します。顧客データはこのCloudflareアカウント内の専用bindingへ保存されます。"
    />
    <form
      class="border-sand bg-panel space-y-5 rounded-2xl border p-6 sm:p-8"
      @submit.prevent="submit"
    >
      <label class="block">
        <span class="text-sm font-semibold">企業名</span>
        <input
          v-model="form.tenantName"
          required
          class="focus-ring border-sand mt-2 w-full rounded-xl border bg-white px-4 py-3"
          placeholder="Example Inc."
        />
      </label>
      <div class="grid gap-5 sm:grid-cols-2">
        <label class="block">
          <span class="text-sm font-semibold">Tenant slug</span>
          <input
            v-model="form.tenantSlug"
            required
            pattern="[a-z0-9-]+"
            class="focus-ring border-sand mt-2 w-full rounded-xl border bg-white px-4 py-3"
            placeholder="example-inc"
          />
        </label>
        <label class="block">
          <span class="text-sm font-semibold">Workspace</span>
          <input
            v-model="form.workspaceName"
            required
            class="focus-ring border-sand mt-2 w-full rounded-xl border bg-white px-4 py-3"
          />
        </label>
      </div>
      <label class="block">
        <span class="text-sm font-semibold">Owner email</span>
        <input
          v-model="form.adminEmail"
          required
          type="email"
          class="focus-ring border-sand mt-2 w-full rounded-xl border bg-white px-4 py-3"
          placeholder="admin@example.com"
        />
      </label>
      <div class="bg-moss-light text-moss rounded-xl p-4 text-sm leading-6">
        Connector credentialはこのフォームでは保存しません。接続時にWorker SecretまたはSecrets
        Storeへ登録します。
      </div>
      <div class="flex items-center justify-between">
        <p role="status" class="text-sm" :class="state === 'error' ? 'text-red-700' : 'text-moss'">
          <span v-if="state === 'saved'">初期設定を保存しました。</span>
          <span v-else-if="state === 'error'"
            >APIへ接続できません。Worker設定を確認してください。</span
          >
        </p>
        <button
          :disabled="state === 'saving'"
          class="focus-ring bg-ink hover:bg-moss rounded-xl px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {{ state === 'saving' ? '保存中…' : 'Tenantを作成' }}
        </button>
      </div>
    </form>
  </div>
</template>
