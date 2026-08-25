import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2026-08-24',
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],
  vite: { plugins: [tailwindcss()] },
  runtimeConfig: {
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE ?? 'http://localhost:8787/api/v1',
    },
  },
  app: {
    head: {
      title: 'Context Connect',
      meta: [
        {
          name: 'description',
          content: '企業の開発履歴を、AIが利用できるContextへ変換する管理基盤',
        },
      ],
    },
  },
})
