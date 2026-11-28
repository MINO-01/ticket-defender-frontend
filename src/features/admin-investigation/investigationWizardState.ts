import { z } from 'zod'

const storageKeyPrefix = 'td.admin-investigation.v1'
const legacyStorageKey = storageKeyPrefix
const uuid = z.string().uuid()
const candidateId = z.string().regex(/^multi-[a-f0-9]{64}$/)

const publishedScopeSchema = z.object({ eventId: uuid, performanceId: uuid }).strict()
const runContextSchema = z.object({ eventId: uuid, runId: uuid }).strict()
const selectionSchema = z.object({
  familyPage: z.number().int().min(0).max(100_000),
  familyId: candidateId,
  candidateId,
}).strict()
const scopeDraftSchema = z.object({
  eventPage: z.number().int().min(0).max(100_000),
  selectedEvents: z.array(uuid).max(500),
  selectedPerformanceMap: z.record(z.string().uuid(), z.array(uuid).max(10_000)),
  periodStart: z.string().min(1).max(32),
  periodEnd: z.string().min(1).max(32),
}).strict()

const snapshotSchema = z.object({
  version: z.literal(1),
  importId: uuid.nullable(),
  publishedScopes: z.array(publishedScopeSchema).max(500),
  runContext: runContextSchema.nullable(),
  selection: selectionSchema.nullable(),
  scopeDraft: scopeDraftSchema.nullable(),
}).strict()

export type InvestigationScopeDraft = z.infer<typeof scopeDraftSchema>
export type InvestigationSelectionRef = z.infer<typeof selectionSchema>
export type InvestigationWizardSnapshot = z.infer<typeof snapshotSchema>

export const emptyInvestigationWizardSnapshot: InvestigationWizardSnapshot = {
  version: 1,
  importId: null,
  publishedScopes: [],
  runContext: null,
  selection: null,
  scopeDraft: null,
}

/**
 * Build a storage namespace from identity claims only. The unverified claims are never used for access decisions;
 * Backend authorization and event-scope checks remain authoritative. Only the digest, never the subject or token,
 * becomes part of the sessionStorage key. A tenant claim is included when the provider supplies one.
 */
export async function investigationStorageNamespace(accessToken: string | null, cryptoProvider: Crypto | undefined = globalThis.crypto): Promise<string | null> {
  try {
    if (accessToken === null || cryptoProvider?.subtle === undefined) return null
    const segments = accessToken.split('.')
    if (segments.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(segments[1])) return null
    const base64 = segments[1].replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    const claims: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (claims === null || typeof claims !== 'object' || Array.isArray(claims)) return null
    const record = claims as Record<string, unknown>
    if (typeof record.sub !== 'string' || record.sub.trim() === ''
      || typeof record.iss !== 'string' || record.iss.trim() === '') return null
    const issuer = record.iss
    const tenant = [record.tenant_id, record.tenantId, record.tid].find((value) => typeof value === 'string')
    const identity = `${issuer}\u0000${record.sub}\u0000${typeof tenant === 'string' ? tenant : ''}`
    const digest = await cryptoProvider.subtle.digest('SHA-256', new TextEncoder().encode(identity))
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
  } catch {
    return null
  }
}

function scopedStorageKey(namespace: string) {
  return /^[0-9a-f]{64}$/.test(namespace) ? `${storageKeyPrefix}.${namespace}` : null
}

export function readInvestigationWizardSnapshot(namespace: string, storage?: Storage): InvestigationWizardSnapshot {
  try {
    const target = storage ?? (typeof window === 'undefined' ? null : window.sessionStorage)
    const key = scopedStorageKey(namespace)
    if (key === null) return emptyInvestigationWizardSnapshot
    target?.removeItem(legacyStorageKey)
    const raw = target?.getItem(key)
    if (raw === undefined || raw === null) return emptyInvestigationWizardSnapshot
    const parsed: unknown = JSON.parse(raw)
    const result = snapshotSchema.safeParse(parsed)
    if (result.success) return result.data
    target?.removeItem(key)
  } catch {
    return emptyInvestigationWizardSnapshot
  }
  return emptyInvestigationWizardSnapshot
}

export function writeInvestigationWizardSnapshot(snapshot: InvestigationWizardSnapshot, namespace: string, storage?: Storage) {
  try {
    const target = storage ?? (typeof window === 'undefined' ? null : window.sessionStorage)
    const key = scopedStorageKey(namespace)
    if (target === null || key === null) return
    target.removeItem(legacyStorageKey)
    const safeSnapshot = snapshotSchema.parse(snapshot)
    target.setItem(key, JSON.stringify(safeSnapshot))
  } catch {
    // Investigation identifiers are optional recovery hints; the workflow remains usable without storage.
  }
}
