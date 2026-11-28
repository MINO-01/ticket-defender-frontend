import { z } from 'zod'

const storageKey = 'td.admin-investigation.v1'
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

export function readInvestigationWizardSnapshot(storage?: Storage): InvestigationWizardSnapshot {
  try {
    const target = storage ?? (typeof window === 'undefined' ? null : window.sessionStorage)
    const raw = target?.getItem(storageKey)
    if (raw === undefined || raw === null) return emptyInvestigationWizardSnapshot
    const parsed: unknown = JSON.parse(raw)
    const result = snapshotSchema.safeParse(parsed)
    if (result.success) return result.data
    target?.removeItem(storageKey)
  } catch {
    return emptyInvestigationWizardSnapshot
  }
  return emptyInvestigationWizardSnapshot
}

export function writeInvestigationWizardSnapshot(snapshot: InvestigationWizardSnapshot, storage?: Storage) {
  try {
    const target = storage ?? (typeof window === 'undefined' ? null : window.sessionStorage)
    if (target === null) return
    const safeSnapshot = snapshotSchema.parse(snapshot)
    target.setItem(storageKey, JSON.stringify(safeSnapshot))
  } catch {
    // Investigation identifiers are optional recovery hints; the workflow remains usable without storage.
  }
}
