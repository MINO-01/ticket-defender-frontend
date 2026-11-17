import { z } from 'zod'
import { adminApiPath } from '../../api/adminApiClient'
import { isUuid } from '../fan-report/intakeConfig'

const uuid = z.string().refine(isUuid).transform((value) => value.toLowerCase())
const dateTime = z.string().datetime({ offset: true })
const sha256 = z.string().regex(/^[a-f0-9]{64}$/)

export const scopeSchema = z.object({ eventId: uuid, performanceId: uuid, scopeAsOf: dateTime.nullable(), declaredRowCount: z.number().int().nonnegative(), cursorStart: z.string().nullable(), cursorEnd: z.string().nullable(), sourceSequenceStart: z.number().int().nonnegative().nullable(), sourceSequenceEnd: z.number().int().nonnegative().nullable() })
export const jobSchema = z.object({ importId: uuid, schemaVersion: z.string(), sourceSystem: z.string(), sourceBatchId: z.string(), mode: z.enum(['FULL_SNAPSHOT', 'CHANGE_FEED']), format: z.literal('CSV'), declaredObjectSha256: sha256, declaredFileBytes: z.number().int().nonnegative(), declaredRowCount: z.number().int().nonnegative(), completeSnapshot: z.boolean(), status: z.enum(['CREATED', 'UPLOAD_PENDING', 'UPLOADED', 'VALIDATING', 'STAGING', 'READY_TO_PUBLISH', 'PUBLISHED', 'FAILED_RETRYABLE', 'REJECTED', 'CANCELLED']), processedRowCount: z.number().int().nonnegative(), acceptedRowCount: z.number().int().nonnegative(), rejectedRowCount: z.number().int().nonnegative(), scopes: z.array(scopeSchema), createdAt: dateTime, updatedAt: dateTime, cancelledAt: dateTime.nullable() })
export type LedgerImportJob = z.infer<typeof jobSchema>
export const jobPageSchema = z.object({ items: z.array(jobSchema), page: z.number().int().nonnegative(), pageSize: z.number().int().positive(), hasNext: z.boolean() })
export const errorsPageSchema = z.object({ items: z.array(z.object({ sequenceNo: z.number().int().nonnegative(), code: z.string(), createdAt: dateTime })), page: z.number().int().nonnegative(), pageSize: z.number().int().positive(), hasNext: z.boolean() })
export const uploadSessionSchema = z.object({ uploadUrl: z.string().url(), expiresAt: dateTime })
export const publicationSchema = z.object({ publicationId: uuid, importId: uuid, sourceSystem: z.string(), sourceBatchId: z.string(), publishedAt: dateTime, scopes: z.array(z.object({ eventId: uuid, performanceId: uuid, previousVersionId: uuid.nullable(), versionId: uuid, generation: z.number().int().nonnegative(), revision: z.number().int().nonnegative(), outboxPending: z.boolean() })) })
export const analysisJobSchema = z.object({ jobId: uuid, outboxId: uuid, versionId: uuid, status: z.enum(['PENDING', 'PROCESSING', 'RETRYABLE', 'BLOCKED', 'DELIVERED']), attemptCount: z.number().int().nonnegative(), failureCode: z.string().nullable(), runId: uuid.nullable(), analysisRequestId: uuid.nullable(), executionStatus: z.string().nullable(), evaluationStatus: z.string().nullable(), policyVersion: z.string().nullable(), algorithmVersion: z.string().nullable(), completedAt: dateTime.nullable() })
export type AnalysisJob = z.infer<typeof analysisJobSchema>
export const analysisJobListSchema = z.array(analysisJobSchema)
export const signalListSchema = z.array(z.object({ ticketReferenceHmac: sha256, hmacKeyVersion: z.string().trim().min(1).max(32), paymentHmac: sha256.nullable().optional(), addressHmac: sha256.nullable().optional(), deviceHmac: sha256.nullable().optional(), ipHmac: sha256.nullable().optional(), sourceVersion: z.string().trim().min(1).max(128) }).superRefine((value, context) => { if (![value.paymentHmac, value.addressHmac, value.deviceHmac, value.ipHmac].some(Boolean)) context.addIssue({ code: 'custom', message: '결제·주소·기기·IP HMAC 중 하나 이상이 필요합니다.' }) })).min(1)
export const emptySchema = z.undefined()

export function ledgerImportsPath() { return adminApiPath('/api/v1/admin/ledger-imports', { page: 0, pageSize: 20 }) }
export function ledgerImportPath(importId: string) { return `/api/v1/admin/ledger-imports/${importId}` }
export function ledgerErrorsPath(importId: string) { return adminApiPath(`${ledgerImportPath(importId)}/errors`, { page: 0, pageSize: 100 }) }
export function uploadSessionPath(importId: string) { return `${ledgerImportPath(importId)}/upload-session` }
export function completeUploadPath(importId: string) { return `${ledgerImportPath(importId)}/complete-upload` }
export function publishPath(importId: string) { return `${ledgerImportPath(importId)}/publish` }
export function publicationPath(importId: string) { return `${ledgerImportPath(importId)}/publication` }
export function analysisRunsPath(eventId: string, performanceId: string) { return `/api/v1/admin/events/${eventId}/ledger-track1/performances/${performanceId}/analysis-runs` }
export function analysisRunPath(eventId: string, performanceId: string, jobId: string) { return `${analysisRunsPath(eventId, performanceId)}/${jobId}` }
export function signalsPath(eventId: string, versionId: string) { return `/api/v1/admin/events/${eventId}/ledger-track1/versions/${versionId}/signals` }

export type CsvMetadata = { bytes: number; sha256: string; rows: number; scopeRows: ReadonlyMap<string, number> }
const shaConstants = new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2])
class StreamingSha256 {
  private state = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]); private tail = new Uint8Array(64); private tailLength = 0; private length = 0n
  private block(bytes: Uint8Array, offset = 0) { const w = new Uint32Array(64); for (let i=0;i<16;i+=1) w[i]=(bytes[offset+i*4]<<24)|(bytes[offset+i*4+1]<<16)|(bytes[offset+i*4+2]<<8)|bytes[offset+i*4+3]; for(let i=16;i<64;i+=1){const a=w[i-15],b=w[i-2];w[i]=(((a>>>7|a<<25)^(a>>>18|a<<14)^(a>>>3))+w[i-16]+((b>>>17|b<<15)^(b>>>19|b<<13)^(b>>>10))+w[i-7])>>>0} let [a,b,c,d,e,f,g,h]=this.state; for(let i=0;i<64;i+=1){const s1=(e>>>6|e<<26)^(e>>>11|e<<21)^(e>>>25|e<<7), ch=(e&f)^((~e)&g), t1=(h+s1+ch+shaConstants[i]+w[i])>>>0, s0=(a>>>2|a<<30)^(a>>>13|a<<19)^(a>>>22|a<<10), maj=(a&b)^(a&c)^(b&c), t2=(s0+maj)>>>0; h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0} const v=[a,b,c,d,e,f,g,h]; for(let i=0;i<8;i+=1)this.state[i]=(this.state[i]+v[i])>>>0 }
  update(input: Uint8Array) { this.length += BigInt(input.length); let offset=0; if(this.tailLength){const need=64-this.tailLength;this.tail.set(input.subarray(0,need),this.tailLength);this.tailLength+=Math.min(need,input.length);offset=Math.min(need,input.length);if(this.tailLength===64){this.block(this.tail);this.tailLength=0}} while(offset+64<=input.length){this.block(input,offset);offset+=64} if(offset<input.length){this.tail.set(input.subarray(offset));this.tailLength=input.length-offset} }
  hex() { const padded=new Uint8Array(this.tailLength+1+((119-this.tailLength)%64)+8);padded.set(this.tail.subarray(0,this.tailLength));padded[this.tailLength]=0x80;let bits=this.length*8n;for(let i=0;i<8;i+=1){padded[padded.length-1-i]=Number(bits&255n);bits>>=8n}for(let i=0;i<padded.length;i+=64)this.block(padded,i);return [...this.state].map((word)=>word.toString(16).padStart(8,'0')).join('') }
}
/** CSV 레코드 수는 인용부호 안의 줄바꿈을 구분자로 보지 않는다. 파일 바이트는 state에 저장하지 않는다. */
/** RFC4180의 헤더는 행 수에서 제외한다. callback은 한 레코드만 보유하므로 대용량 파일을 복사하지 않는다. */
export async function inspectCsv(file: File): Promise<CsvMetadata> {
  if (file.size === 0) throw new Error('빈 CSV 파일은 등록할 수 없습니다.')
  const reader = file.stream().getReader(); const decoder = new TextDecoder(); const digest = new StreamingSha256(); const scopeRows = new Map<string, number>(); let header: string[] | null = null; let eventIndex = -1; let performanceIndex = -1; let field = ''; let record: string[] = []; let quoted = false; let quotePending = false; let skipLf = false; let rows = 0
  const finishRecord = () => { record.push(field); field = ''; if (header === null) { header = record.map((value, index) => index === 0 ? value.replace(/^\uFEFF/, '') : value); eventIndex = header.indexOf('event_id'); performanceIndex = header.indexOf('performance_id'); if (eventIndex < 0 || performanceIndex < 0) throw new Error('CSV 헤더에 event_id와 performance_id가 필요합니다.') } else { if (record.length !== header.length) throw new Error('CSV 열 수가 헤더와 맞지 않습니다.'); const eventId = record[eventIndex]?.trim().toLowerCase(); const performanceId = record[performanceIndex]?.trim().toLowerCase(); if (!isUuid(eventId) || !isUuid(performanceId)) throw new Error('CSV의 event_id 또는 performance_id가 UUID가 아닙니다.'); const key = `${eventId}:${performanceId}`; scopeRows.set(key, (scopeRows.get(key) ?? 0) + 1); rows += 1 } record = [] }
  const consume = (text: string) => { for (let index = 0; index < text.length; index += 1) { const char = text[index]; if (skipLf) { skipLf = false; if (char === '\n') continue } if (quotePending) { quotePending = false; if (char === '"') { field += '"'; quoted = true; continue } quoted = false }
      if (quoted) { if (char === '"') { quotePending = true } else field += char; continue }
      if (char === '"') { if (field.length !== 0) throw new Error('CSV 따옴표 위치가 올바르지 않습니다.'); quoted = true; continue }
      if (char === ',') { record.push(field); field = ''; continue }
      if (char === '\r' || char === '\n') { finishRecord(); if (char === '\r') skipLf = true; continue }
      field += char
    } }
  for (;;) { const next = await reader.read(); if (next.done) break; digest.update(next.value); consume(decoder.decode(next.value, { stream: true })) }
  consume(decoder.decode())
  if (quotePending) quoted = false
  if (quoted) throw new Error('CSV 인용부호가 닫히지 않았습니다.')
  if (field.length !== 0 || record.length !== 0) finishRecord()
  if (header === null) throw new Error('CSV 헤더가 필요합니다.')
  return { bytes: file.size, sha256: digest.hex(), rows, scopeRows }
}

export function validateScope(mode: 'FULL_SNAPSHOT' | 'CHANGE_FEED', scope: { performanceId: string; scopeAsOf: string; cursorStart: string; cursorEnd: string; sequenceStart: string; sequenceEnd: string; declaredRowCount: string }) {
  if (!isUuid(scope.performanceId)) return 'ACTIVE 회차를 선택해 주세요.'
  const count = Number(scope.declaredRowCount)
  if (!Number.isSafeInteger(count) || count < 0) return 'scope 행 수는 0 이상의 정수여야 합니다.'
  if (mode === 'FULL_SNAPSHOT' && (!scope.scopeAsOf || !scope.cursorEnd || !scope.sequenceEnd)) return 'FULL_SNAPSHOT에는 기준시각, cursorEnd, sourceSequenceEnd가 필요합니다.'
  if (mode === 'CHANGE_FEED' && (!scope.cursorStart || !scope.cursorEnd || !scope.sequenceStart || !scope.sequenceEnd)) return 'CHANGE_FEED에는 시작·종료 cursor와 source sequence가 필요합니다.'
  if (mode === 'CHANGE_FEED' && (!Number.isSafeInteger(Number(scope.sequenceStart)) || !Number.isSafeInteger(Number(scope.sequenceEnd)) || Number(scope.sequenceStart) < 0 || Number(scope.sequenceEnd) < Number(scope.sequenceStart) || Number(scope.sequenceEnd) - Number(scope.sequenceStart) + 1 !== count)) return 'CHANGE_FEED sourceSequence 범위는 scope 행 수와 정확히 일치해야 합니다.'
  return null
}
