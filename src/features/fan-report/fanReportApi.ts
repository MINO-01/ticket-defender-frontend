import { z } from 'zod'

// Backend W02 fan-report-intake-v1.yaml 계약을 따르는 요청과 응답 처리만 담당한다.
// 비밀값, 조회 코드, 입력 내용은 로그나 URL에 남기지 않는다.

export const fanReportEndpoint = '/api/v1/fan-reports'
export const fanReportLookupEndpoint = '/api/v1/fan-reports/lookup'

/** 계약에 명시된 report 파트 필드만 포함한다. tenantId, performanceRef, 저장소 키는 보내지 않는다. */
export type FanReportSubmission = {
  eventId: string
  performanceAt: string
  seatArea?: string
  reportType: 'PREMIUM_RESALE' | 'AUTOMATION_OFFER' | 'FAKE_TICKET' | 'OTHER'
  description: string
  listingUrl?: string
  platform?: string
  seller?: string
  askingPrice?: string
}

const intakeStatusSchema = z.enum(['RECEIVED', 'ANALYSIS_PENDING', 'ANALYSIS_FAILED', 'UNVERIFIABLE'])
export type IntakeStatus = z.infer<typeof intakeStatusSchema>

const receiptSchema = z.object({
  fanReportId: z.guid(),
  receiptNumber: z.string().min(1).max(40),
  lookupCode: z.string().min(1).max(64),
  intakeStatus: intakeStatusSchema,
  receivedAt: z.iso.datetime({ offset: true }),
})
export type FanReportReceipt = z.infer<typeof receiptSchema>

const lookupResponseSchema = z.object({
  intakeStatus: intakeStatusSchema,
  receivedAt: z.iso.datetime({ offset: true }),
})
export type FanReportLookupResult = z.infer<typeof lookupResponseSchema>

/** 제출 요청 하나를 구성하는 불변 값. 재시도 시 이 값을 그대로 재전송한다. */
export type SubmissionRequest = Readonly<{
  report: Readonly<FanReportSubmission>
  evidence: readonly File[]
  idempotencyKey: string
  recoverySecret: string
}>

export type ApiFailure =
  | { kind: 'problem'; status: number; code: string }
  | { kind: 'network' }
  | { kind: 'invalidResponse'; status: number }

export type SubmitResult = { kind: 'success'; status: 200 | 201; receipt: FanReportReceipt } | ApiFailure
export type LookupResult = { kind: 'success'; result: FanReportLookupResult } | ApiFailure

type FetchLike = typeof fetch

const problemCodePattern = /^[A-Z][A-Z0-9_]{0,63}$/

/** problem+json 응답에서 code만 읽는다. 서버의 상세 메시지는 화면에 노출하지 않는다. */
async function readProblemCode(response: Response) {
  try {
    const body: unknown = await response.json()
    const code = typeof body === 'object' && body !== null ? (body as { code?: unknown }).code : undefined
    return typeof code === 'string' && problemCodePattern.test(code) ? code : 'UNKNOWN'
  } catch {
    return 'UNKNOWN'
  }
}

export async function submitFanReport(request: SubmissionRequest, fetchImpl: FetchLike = fetch): Promise<SubmitResult> {
  const body = new FormData()
  body.append('report', new Blob([JSON.stringify(request.report)], { type: 'application/json' }))
  request.evidence.forEach((file) => body.append('evidence', file, file.name))

  let response: Response
  try {
    // Content-Type은 브라우저가 multipart boundary와 함께 생성하도록 지정하지 않는다.
    response = await fetchImpl(fanReportEndpoint, {
      method: 'POST',
      headers: { 'Idempotency-Key': request.idempotencyKey, 'Report-Recovery-Secret': request.recoverySecret, Accept: 'application/json, application/problem+json' },
      body,
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    })
  } catch {
    return { kind: 'network' }
  }

  if (response.status === 200 || response.status === 201) {
    try {
      const parsed = receiptSchema.safeParse(await response.json())
      if (parsed.success) return { kind: 'success', status: response.status, receipt: parsed.data }
    } catch {
      // 본문을 읽지 못하면 응답 유실과 같이 처리한다.
    }
    return { kind: 'invalidResponse', status: response.status }
  }
  return { kind: 'problem', status: response.status, code: await readProblemCode(response) }
}

export async function lookupFanReport(receiptNumber: string, lookupCode: string, fetchImpl: FetchLike = fetch): Promise<LookupResult> {
  let response: Response
  try {
    // 조회 코드는 URL이나 query string이 아닌 JSON 본문으로만 보낸다.
    response = await fetchImpl(fanReportLookupEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, application/problem+json' },
      body: JSON.stringify({ receiptNumber, lookupCode }),
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    })
  } catch {
    return { kind: 'network' }
  }

  if (response.status === 200) {
    try {
      const parsed = lookupResponseSchema.safeParse(await response.json())
      if (parsed.success) return { kind: 'success', result: parsed.data }
    } catch {
      // 구조가 맞지 않는 응답은 성공으로 표시하지 않는다.
    }
    return { kind: 'invalidResponse', status: response.status }
  }
  return { kind: 'problem', status: response.status, code: await readProblemCode(response) }
}
