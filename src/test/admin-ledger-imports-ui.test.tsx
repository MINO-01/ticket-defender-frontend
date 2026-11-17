import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdminAuthProvider } from '../features/admin-auth/AdminAuthProvider'
import type { AdminAuthAdapter } from '../features/admin-auth/authAdapter'
import { RequireAdminAuth } from '../features/admin-auth/RequireAdminAuth'
import { LiveLedgerImportsPage } from '../features/admin-ledger-imports/LiveLedgerImportsPage'

const eventId = '11111111-1111-4111-8111-111111111111'; const performanceId = '22222222-2222-4222-8222-222222222222'; const importId = '33333333-3333-4333-8333-333333333333'
const adapter = (): AdminAuthAdapter => ({ availability: { status: 'ready' }, initialize: vi.fn(async () => ({ value: 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMtYWRtaW4ifQ.c3ludGhldGljLXNpZ25hdHVyZQ', expiresAt: Date.now() + 600000 })), signIn: vi.fn(async () => undefined), signOut: vi.fn(async () => undefined) })
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
const job = { importId, schemaVersion: 'v2', sourceSystem: 'synthetic', sourceBatchId: 'batch', mode: 'FULL_SNAPSHOT', format: 'CSV', declaredObjectSha256: 'a'.repeat(64), declaredFileBytes: 10, declaredRowCount: 0, completeSnapshot: true, status: 'CREATED', processedRowCount: 0, acceptedRowCount: 0, rejectedRowCount: 0, scopes: [{ eventId, performanceId, scopeAsOf: '2026-11-17T00:00:00Z', declaredRowCount: 0, cursorStart: null, cursorEnd: 'end', sourceSequenceStart: null, sourceSequenceEnd: 0 }], createdAt: '2026-11-17T00:00:00Z', updatedAt: '2026-11-17T00:00:00Z', cancelledAt: null }

afterEach(() => vi.unstubAllGlobals())
describe('대용량 원장 관리자 화면', () => {
  it('CREATED 작업도 업로드 세션 발급 흐름을 열고 완료 상태와 혼동하지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input) => { const url = String(input); if (url.startsWith('/api/v1/admin/events?')) return json({ items: [{ id: eventId, externalEventId: 'event', name: '합성 공연' }], page: 0, pageSize: 100, totalItems: 1, hasNext: false }); if (url === '/api/v1/admin/ledger-imports?page=0&pageSize=20') return json({ items: [job], page: 0, pageSize: 20, hasNext: false }); if (url === `/api/v1/admin/events/${eventId}/verified-performances`) return json([{ performanceId, eventId, performanceRef: '회차 A', status: 'ACTIVE', revision: 1, sourceVersion: 'v1', verifiedAt: '2026-11-17T00:00:00Z', withdrawnAt: null }]); if (url.includes('/errors')) return json({ items: [], page: 0, pageSize: 100, hasNext: false }); if (url.includes('/analysis-runs')) return json([]); return new Response(null, { status: 404 }) }))
    render(<MemoryRouter initialEntries={[`/app/ledger-imports?eventId=${eventId}`]}><AdminAuthProvider adapter={adapter()}><RequireAdminAuth><LiveLedgerImportsPage /></RequireAdminAuth></AdminAuthProvider></MemoryRouter>)
    expect(await screen.findByRole('button', { name: '업로드 세션 발급 및 비공개 업로드' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '모든 scope 원장 공개' })).not.toBeInTheDocument()
  })
})
