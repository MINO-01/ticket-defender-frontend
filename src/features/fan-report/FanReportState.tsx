import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { FormProvider, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { evidencePolicy, initialReportDraft, reportSchema } from './reportModel'
import type { ReportDraft } from './reportModel'

export type EvidenceItem = { id: number; file: File; previewUrl: string }

type FanReportState = {
  evidence: EvidenceItem[]
  fileError: string
  setFileError: (message: string) => void
  addEvidence: (files: FileList | File[]) => void
  removeEvidence: (id: number) => void
  reviewReady: boolean
  setReviewReady: (ready: boolean) => void
}

const StateContext = createContext<FanReportState | null>(null)

export function FanReportProvider({ children }: { children: ReactNode }) {
  const form = useForm<ReportDraft>({ defaultValues: initialReportDraft, resolver: zodResolver(reportSchema), mode: 'onChange' })
  const [evidence, setEvidence] = useState<EvidenceItem[]>([])
  const [fileError, setFileError] = useState('')
  const [reviewReady, setReviewReady] = useState(false)
  const urls = useRef(new Set<string>())
  const nextId = useRef(0)

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

  return <StateContext.Provider value={{ evidence, fileError, setFileError, addEvidence, removeEvidence, reviewReady, setReviewReady }}>
    <FormProvider {...form}>{children}</FormProvider>
  </StateContext.Provider>
}

export function useFanReport() {
  const context = useContext(StateContext)
  if (!context) throw new Error('FanReportProvider가 필요합니다.')
  return context
}
