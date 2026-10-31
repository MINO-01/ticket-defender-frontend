import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { FormProvider, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { evidencePolicy, initialReportDraft, reportSchema } from './reportModel'
import type { ReportDraft } from './reportModel'
import { submitFanReport } from './fanReportApi'
import type { FanReportLookupResult, FanReportReceipt, SubmissionRequest } from './fanReportApi'
import { createSubmissionRequest, describeSubmitFailure, toSubmission } from './submission'
import type { FailureView } from './submission'
import { getIntakeEvent } from './intakeConfig'

export type EvidenceItem = { id: number; file: File; previewUrl: string }

export type SubmissionState = { phase: 'idle' } | { phase: 'submitting' } | { phase: 'failed'; failure: FailureView }

/** 실제 서버 응답으로 받은 접수 결과. 메모리에만 보관한다. */
export type ReceiptState = { receipt: FanReportReceipt; recovered: boolean }

type FanReportState = {
  evidence: EvidenceItem[]
  fileError: string
  setFileError: (message: string) => void
  addEvidence: (files: FileList | File[]) => void
  removeEvidence: (id: number) => void
  reviewReady: boolean
  setReviewReady: (ready: boolean) => void
  submission: SubmissionState
  pendingRequest: SubmissionRequest | null
  submitReport: () => Promise<boolean>
  receipt: ReceiptState | null
  lookupResult: FanReportLookupResult | null
  setLookupResult: (result: FanReportLookupResult | null) => void
}

type Attempt = { request: SubmissionRequest }

const StateContext = createContext<FanReportState | null>(null)

export function FanReportProvider({ children }: { children: ReactNode }) {
  const form = useForm<ReportDraft>({ defaultValues: initialReportDraft, resolver: zodResolver(reportSchema), mode: 'onChange' })
  const [evidence, setEvidence] = useState<EvidenceItem[]>([])
  const [fileError, setFileError] = useState('')
  const [reviewReady, setReviewReady] = useState(false)
  const [submission, setSubmission] = useState<SubmissionState>({ phase: 'idle' })
  const [pendingRequest, setPendingRequest] = useState<SubmissionRequest | null>(null)
  const [receipt, setReceipt] = useState<ReceiptState | null>(null)
  const [lookupResult, setLookupResult] = useState<FanReportLookupResult | null>(null)
  const urls = useRef(new Set<string>())
  const nextId = useRef(0)
  // 비밀값을 포함한 제출 시도는 React 메모리에만 두고 브라우저 저장소나 URL에 기록하지 않는다.
  const attempt = useRef<Attempt | null>(null)
  const inFlight = useRef(false)

  useEffect(() => () => { urls.current.forEach((url) => URL.revokeObjectURL(url)); urls.current.clear() }, [])

  function addEvidence(files: FileList | File[]) {
    const selected = Array.from(files)
    const accepted: EvidenceItem[] = []
    const errors: string[] = []
    const remaining = evidencePolicy.maxFiles - evidence.length

    selected.forEach((file) => {
      const extension = file.name.split('.').pop()?.toLowerCase()
      if (!evidencePolicy.mimeTypes.some((mime) => mime === file.type) || !evidencePolicy.extensions.some((allowed) => allowed === extension)) {
        errors.push(`${file.name}: JPEG 또는 PNG 파일만 선택할 수 있습니다.`)
      } else if (file.size === 0) {
        errors.push(`${file.name}: 비어 있는 파일은 선택할 수 없습니다.`)
      } else if (file.size > evidencePolicy.maxBytes) {
        errors.push(`${file.name}: 파일당 20MB를 넘을 수 없습니다.`)
      } else if (accepted.length >= remaining) {
        errors.push('첨부파일은 최대 5개까지 선택할 수 있습니다.')
      } else {
        const previewUrl = URL.createObjectURL(file)
        urls.current.add(previewUrl)
        accepted.push({ id: ++nextId.current, file, previewUrl })
      }
    })

    if (accepted.length) setEvidence((current) => [...current, ...accepted])
    setFileError([...new Set(errors)].join(' '))
    setReviewReady(false)
  }

  function removeEvidence(id: number) {
    const removed = evidence.find((item) => item.id === id)
    if (removed) {
      URL.revokeObjectURL(removed.previewUrl)
      urls.current.delete(removed.previewUrl)
    }
    setEvidence((current) => current.filter((item) => item.id !== id))
    setFileError('')
    setReviewReady(false)
  }

  function clearDraft() {
    urls.current.forEach((url) => URL.revokeObjectURL(url))
    urls.current.clear()
    setEvidence([])
    setFileError('')
    setReviewReady(false)
    form.reset(initialReportDraft)
  }

  function fail(failure: FailureView) {
    setSubmission({ phase: 'failed', failure })
    return false
  }

  /** 제출 시도를 실행한다. 결과가 불확실하면 같은 시도를 유지하고, 서버가 실패를 확정한 경우에만 시도를 폐기한다. */
  async function submitReport() {
    if (inFlight.current) return false
    inFlight.current = true
    try {
      let current = attempt.current
      if (!current) {
        const intakeEvent = getIntakeEvent()
        if (!intakeEvent) return fail({ category: 'rejected', title: '실제 접수가 설정되지 않았습니다', description: '접수 가능한 공연이 설정되지 않은 환경입니다. 제보가 전송되지 않았습니다.' })
        if (!(await form.trigger())) return fail({ category: 'rejected', title: '입력 내용을 확인해 주세요', description: '필수 항목을 확인한 뒤 다시 제출해 주세요. 제보가 전송되지 않았습니다.' })
        const report = toSubmission(form.getValues(), intakeEvent.eventId)
        if (!report) return fail({ category: 'rejected', title: '실제 접수 가능한 공연이 아닙니다', description: '시연용 공연은 실제로 접수할 수 없습니다. 작성 화면에서 접수 가능한 공연을 선택해 주세요.' })
        current = { request: createSubmissionRequest(report, evidence.map((item) => item.file)) }
        attempt.current = current
        setPendingRequest(current.request)
      }

      setSubmission({ phase: 'submitting' })
      const result = await submitFanReport(current.request)
      if (result.kind === 'success') {
        attempt.current = null
        setPendingRequest(null)
        setReceipt({ receipt: result.receipt, recovered: result.status === 200 })
        setSubmission({ phase: 'idle' })
        clearDraft()
        return true
      }

      const failure = describeSubmitFailure(result)
      // 서버가 실패를 확정한 경우에만 시도를 폐기한다. 입력과 첨부는 유지해 사용자가 직접 새 요청을 시작할 수 있다.
      if (failure.category === 'rejected') {
        attempt.current = null
        setPendingRequest(null)
      }
      return fail(failure)
    } finally {
      inFlight.current = false
    }
  }

  return <StateContext.Provider value={{ evidence, fileError, setFileError, addEvidence, removeEvidence, reviewReady, setReviewReady, submission, pendingRequest, submitReport, receipt, lookupResult, setLookupResult }}>
    <FormProvider {...form}>{children}</FormProvider>
  </StateContext.Provider>
}

export function useFanReport() {
  const context = useContext(StateContext)
  if (!context) throw new Error('FanReportProvider가 필요합니다.')
  return context
}
