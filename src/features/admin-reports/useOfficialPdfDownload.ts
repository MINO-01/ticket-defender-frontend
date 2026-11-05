import { useCallback, useEffect, useRef, useState } from 'react'
import type { AdminApiFailure } from '../../api/adminApiFailure'
import { useAdminApiClient } from '../admin-auth/AdminAuthProvider'
import type { WorkflowMessage } from '../admin-cases/caseWorkflowApi'
import {
  describeOfficialPdfCode, hasDownloadableArtifact, issuanceDetailPath, issuanceDownloadPath, issuanceHidden, issuanceSchema, sha256HexOf, tenantAdminOnly,
} from './officialPdfApi'

// 인증된 Backend API로 공식 PDF 바이트를 받아 검증한 뒤 임시 Blob URL로만 내려받는다.
// 1) 발급 상세를 다시 조회해 GENERATED와 서버의 pdfSha256, pdfSize를 확인한다. 2) 바이너리를 받는다. 3) 크기와 SHA-256을 대조한다.
// 대조가 끝나기 전에는 파일을 만들지 않는다. PDF 바이트, 객체 키, URL은 브라우저 저장소와 로그에 남기지 않고 외부 뷰어로 보내지 않는다.
// 클릭 직후 동기 해제하면 다운로드가 시작되지 못할 수 있어 일정 시간 뒤 해제하고, 화면이 사라지면 남은 URL과 대기 요청을 정리한다.

const revokeDelayMs = 30_000

export type DownloadState =
  | { kind: 'idle' }
  | { kind: 'downloading' }
  | { kind: 'done'; byteSize: number }
  | { kind: 'failed'; message: WorkflowMessage }

const notSaved = '파일을 만들지 않았습니다.'
const mismatch: WorkflowMessage = { title: '내려받은 PDF가 서버 기록과 다릅니다', description: `받은 바이트의 크기나 SHA-256이 발급 기록과 맞지 않습니다. ${notSaved}` }

function describe(failure: AdminApiFailure, invalid: WorkflowMessage): WorkflowMessage {
  switch (failure.kind) {
    case 'unauthenticated':
      return { title: '관리자 세션이 만료되었습니다', description: `다시 로그인한 뒤 다운로드해 주세요. ${notSaved}` }
    case 'forbidden':
      return tenantAdminOnly('공식 PDF 다운로드')
    case 'notFound':
      return issuanceHidden
    case 'network':
      return { title: '서버에 연결하지 못했습니다', description: `네트워크 상태를 확인한 뒤 다시 시도해 주세요. ${notSaved}` }
    case 'invalidResponse':
      return invalid
    case 'problem': {
      const message = describeOfficialPdfCode(failure.code)
      return { title: message.title, description: `${message.description} ${notSaved}` }
    }
  }
}

export function useOfficialPdfDownload() {
  const client = useAdminApiClient()
  const [state, setState] = useState<DownloadState>({ kind: 'idle' })
  // 상태 갱신은 비동기라 연속 클릭을 막지 못하므로 진행 여부를 동기적으로 기록한다.
  const busyRef = useRef(false)
  const controllerRef = useRef<AbortController | null>(null)
  const urlsRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  useEffect(() => {
    const urls = urlsRef.current
    return () => {
      controllerRef.current?.abort()
      controllerRef.current = null
      busyRef.current = false
      for (const [url, timer] of urls) {
        clearTimeout(timer)
        URL.revokeObjectURL(url)
      }
      urls.clear()
    }
  }, [])

  const save = useCallback((bytes: Uint8Array<ArrayBuffer>, artifactId: string) => {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `official-case-report-${artifactId}.pdf`
    anchor.rel = 'noopener'
    anchor.style.display = 'none'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    const timer = setTimeout(() => {
      urlsRef.current.delete(url)
      URL.revokeObjectURL(url)
    }, revokeDelayMs)
    urlsRef.current.set(url, timer)
  }, [])

  /** 발급 기록 한 건의 PDF를 검증해 내려받는다. 진행 중이면 보내지 않는다. 자동으로 다시 시도하지 않는다. */
  const download = useCallback(async (issuanceId: string, decisionId: string) => {
    if (busyRef.current) return
    busyRef.current = true
    const controller = new AbortController()
    controllerRef.current = controller
    setState({ kind: 'downloading' })
    const run = async (): Promise<DownloadState> => {
      const detail = await client.request(issuanceDetailPath(issuanceId), { schema: issuanceSchema, signal: controller.signal })
      if (detail.kind !== 'success') return { kind: 'failed', message: describe(detail, { title: '발급 상세 응답 형식이 계약과 다릅니다', description: `서버 기록을 확인하지 못했습니다. ${notSaved}` }) }
      const record = detail.data
      if (record.officialPdfIssuanceId !== issuanceId || record.approvalDecisionId !== decisionId) {
        return { kind: 'failed', message: { title: '발급 상세가 요청과 맞지 않습니다', description: `다른 발급 기록의 응답이어서 사용하지 않았습니다. ${notSaved}` } }
      }
      if (!hasDownloadableArtifact(record)) return { kind: 'failed', message: describe({ kind: 'problem', status: 409, code: 'OFFICIAL_PDF_NOT_GENERATED' }, mismatch) }
      const file = await client.requestPdf(issuanceDownloadPath(issuanceId), { signal: controller.signal })
      if (file.kind !== 'success') return { kind: 'failed', message: describe(file, { title: 'PDF 응답 형식을 확인하지 못했습니다', description: `PDF 형식이 아니거나 Frontend 임시 상한(20 MiB)을 넘거나 응답이 잘렸습니다. ${notSaved}` }) }
      // 주된 무결성 기준은 서버가 기록한 크기와 SHA-256이다.
      if (file.data.byteSize !== record.pdfSize) return { kind: 'failed', message: mismatch }
      const digest = await sha256HexOf(file.data.bytes)
      if (digest === null) return { kind: 'failed', message: { title: 'PDF 무결성을 확인할 수 없습니다', description: `이 브라우저에서 SHA-256을 계산할 수 없습니다. ${notSaved}` } }
      if (digest !== record.pdfSha256) return { kind: 'failed', message: mismatch }
      if (controller.signal.aborted) return { kind: 'idle' }
      save(file.data.bytes, record.artifactId)
      return { kind: 'done', byteSize: file.data.byteSize }
    }
    let next: DownloadState
    try {
      next = await run()
    } catch {
      next = { kind: 'failed', message: { title: '요청을 보내지 않았습니다', description: `요청 경로 검사에 실패했습니다. ${notSaved}` } }
    } finally {
      busyRef.current = false
      if (controllerRef.current === controller) controllerRef.current = null
    }
    if (controller.signal.aborted) return
    setState(next)
  }, [client, save])

  return { state, download }
}
