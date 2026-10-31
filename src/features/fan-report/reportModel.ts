import { z } from 'zod'

export const evidencePolicy = {
  maxFiles: 5,
  maxBytes: 20 * 1024 * 1024,
  mimeTypes: ['image/jpeg', 'image/png'],
  extensions: ['jpg', 'jpeg', 'png'],
} as const

export const reportTypes = [
  { value: 'PREMIUM_RESALE', label: '고액 재판매 정황' },
  { value: 'AUTOMATION_OFFER', label: '매크로·대리 예매 제안' },
  { value: 'FAKE_TICKET', label: '위조 티켓·결제 사기 의심' },
  { value: 'OTHER', label: '기타 의심 거래' },
] as const

// 화면 시연 전용 공연. 실제 접수 API로는 전송하지 않는다.
export const demoEvent = { value: 'DEMO_AUTUMN_LIVE', label: '2026 Autumn Live (합성 데모 공연, 접수 불가)' } as const

function isWebUrl(value: string) {
  if (!value) return true
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

export const reportSchema = z.object({
  eventId: z.string().min(1, '공연을 선택해 주세요.'),
  performanceAt: z.string().min(1, '공연 일시를 입력해 주세요.'),
  seatArea: z.string().max(160, '좌석 정보는 160자 이내로 입력해 주세요.'),
  reportType: z.string().min(1, '제보 유형을 선택해 주세요.'),
  description: z.string().trim().min(20, '상황을 20자 이상 설명해 주세요.').max(1000, '설명은 1,000자 이내로 입력해 주세요.'),
  listingUrl: z.string().trim().max(2048, '주소는 2,048자 이내로 입력해 주세요.').refine(isWebUrl, 'http 또는 https로 시작하는 주소를 입력해 주세요.'),
  platform: z.string().max(160, '판매 플랫폼은 160자 이내로 입력해 주세요.'),
  seller: z.string().max(160, '판매자 표시명은 160자 이내로 입력해 주세요.'),
  askingPrice: z.string(),
}).superRefine((draft, context) => {
  if (draft.reportType === 'PREMIUM_RESALE' && draft.askingPrice && !/^[1-9][0-9]{0,11}$/.test(draft.askingPrice)) {
    context.addIssue({ code: 'custom', path: ['askingPrice'], message: '가격은 0보다 큰 숫자로 입력해 주세요.' })
  }
})

export type ReportDraft = z.infer<typeof reportSchema>

export const initialReportDraft: ReportDraft = {
  eventId: '', performanceAt: '', seatArea: '', reportType: '', description: '',
  listingUrl: '', platform: '', seller: '', askingPrice: '',
}

export const lookupSchema = z.object({
  receiptNumber: z.string().trim().min(1, '접수번호를 입력해 주세요.').max(40, '접수번호 형식을 확인해 주세요.'),
  lookupCode: z.string().trim().min(1, '조회 코드를 입력해 주세요.').max(64, '조회 코드 형식을 확인해 주세요.'),
})

export type LookupFields = z.infer<typeof lookupSchema>
