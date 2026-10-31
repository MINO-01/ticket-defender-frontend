import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

export default defineConfig(({ mode }) => {
  // 개발 서버에서만 동일 출처 /api 호출을 격리된 로컬 Backend로 전달한다. 클라이언트 번들에 노출되지 않도록 VITE_ 접두사를 쓰지 않는다.
  const proxyTarget = loadEnv(mode, process.cwd(), 'TD_').TD_DEV_API_PROXY_TARGET?.trim()
  return {
    plugins: [react()],
    server: proxyTarget ? { proxy: { '/api': { target: proxyTarget, changeOrigin: false, secure: true } } } : undefined,
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      css: true,
      testTimeout: 30000,
    },
  }
})
