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

export const demoEvent = { value: 'DEMO_AUTUMN_LIVE', label: '2026 Autumn Live (합성 데모 공연)' } as const

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
  seatArea: z.string(),
  reportType: z.string().min(1, '제보 유형을 선택해 주세요.'),
  description: z.string().trim().min(20, '상황을 20자 이상 설명해 주세요.').max(1000, '설명은 1,000자 이내로 입력해 주세요.'),
  listingUrl: z.string().trim().refine(isWebUrl, 'http 또는 https로 시작하는 주소를 입력해 주세요.'),
  platform: z.string(),
  seller: z.string(),
  askingPrice: z.string(),
}).superRefine((draft, context) => {
  if (draft.reportType === 'PREMIUM_RESALE' && draft.askingPrice && (!/^\d+$/.test(draft.askingPrice) || Number(draft.askingPrice) <= 0)) {
    context.addIssue({ code: 'custom', path: ['askingPrice'], message: '가격은 0보다 큰 숫자로 입력해 주세요.' })
  }
})

export type ReportDraft = z.infer<typeof reportSchema>

export const initialReportDraft: ReportDraft = {
  eventId: '', performanceAt: '', seatArea: '', reportType: '', description: '',
  listingUrl: '', platform: '', seller: '', askingPrice: '',
}

export const lookupSchema = z.object({
  receiptNumber: z.string().trim().min(1, '접수번호를 입력해 주세요.'),
  secretCode: z.string().trim().min(1, '조회 코드를 입력해 주세요.'),
})

export type LookupFields = z.infer<typeof lookupSchema>
