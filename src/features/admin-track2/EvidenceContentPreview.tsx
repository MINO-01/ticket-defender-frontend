import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { describeAdminApiFailure } from '../../api/adminApiFailure'
import type { AdminApiFailure } from '../../api/adminApiFailure'
import { evidenceImageMediaTypes } from '../../api/imageResponse'
import { Button } from '../../components/common/Button'
import { ErrorState, LoadingSkeleton } from '../../components/common/Feedback'
import { useAdminApiClient, useAdminAuth } from '../admin-auth/AdminAuthProvider'
import { evidenceContentPath, formatBytes } from './track2Api'
import type { FanReportEvidence } from './track2Api'
import styles from './Track2.module.css'

// 인증된 관리자가 클릭한 증거 하나의 비공개 원본 이미지를 Backend 프록시 API로 받아 미리보기한다.
// 권한, 고객사와 공연 범위, 보존 기한, 무결성 검증과 열람 감사는 Backend가 수행하며 이 화면은 검증된 응답만 표시한다.
// 이미지 바이트는 메모리의 Blob URL로만 표시하고 브라우저 저장소에 남기지 않는다. 다운로드와 합성 데모 이미지 대체는 제공하지 않는다.
// Blob URL 해제는 이 화면의 메모리 정리이며, 이미 브라우저에 표시된 이미지의 복사나 저장을 막는 보안 장치가 아니다.

type Settled =
  | { key: string; kind: 'image'; url: string; byteSize: number }
  | { key: string; kind: 'failure'; failure: AdminApiFailure }

type Message = { title: string; description: string; retryable: boolean }

const notVerified = '원본을 확인하지 못했으며 빈 이미지로 간주하지 않습니다.'
const integrityCodes = new Set(['OBJECT_CHANGED', 'OBJECT_MISSING', 'SIZE_MISMATCH', 'MEDIA_TYPE_MISMATCH', 'HASH_MISMATCH'])

/** Backend admin-evidence-content-v1 오류를 고정 문구로 바꾼다. 서버의 detail, 객체 키, 저장소 정보는 표시하지 않는다. */
export function describeEvidenceContentFailure(failure: AdminApiFailure): Message {
  switch (failure.kind) {
    case 'forbidden':
      return { title: '이 원본을 볼 수 있는 역할이 없습니다', description: '인증은 되었지만 원본 열람에 필요한 관리자 역할이 없습니다. 고객사 관리자에게 역할을 확인해 주세요.', retryable: false }
    case 'notFound':
      return { title: '원본을 찾을 수 없거나 접근 범위 밖입니다', description: '존재하지 않거나 현재 계정의 접근 범위 밖입니다. 두 경우는 구분해 안내하지 않습니다.', retryable: false }
    case 'invalidResponse':
      return { title: '이미지 응답을 확인하지 못했습니다', description: `응답이 PNG 또는 JPEG 이미지 계약과 달라 표시하지 않았습니다. ${notVerified}`, retryable: true }
    case 'unauthenticated':
    case 'network':
      return { ...describeAdminApiFailure(failure, ''), retryable: failure.kind === 'network' }
    case 'problem':
      break
  }
  const { status, code } = failure
  if (status === 409 && code === 'SOURCE_CHANGED') return { title: '원본 정보가 확인 중 바뀌었습니다', description: `원본을 읽는 동안 저장 정보가 바뀌어 표시하지 않았습니다. 다시 시도해 주세요. ${notVerified}`, retryable: true }
  if (status === 422 && code === 'SOURCE_NOT_AVAILABLE') return { title: '원본을 제공할 수 없는 상태입니다', description: '원본 저장이 끝나지 않았거나 저장에 실패한 증거입니다.', retryable: false }
  if (status === 422 && code === 'RETENTION_EXPIRED') return { title: '보존 기한이 지나 원본을 표시하지 않습니다', description: '제보 또는 증거의 보존 기한이 지났습니다.', retryable: false }
  if (status === 422 && integrityCodes.has(code)) return { title: '원본 무결성을 확인하지 못했습니다', description: `저장된 원본이 접수 기록과 같은지 확인하지 못해 표시하지 않았습니다. 분류 코드 ${code}. ${notVerified}`, retryable: false }
  if (status === 422 && (code === 'UNSUPPORTED_IMAGE_TYPE' || code === 'EVIDENCE_CONTENT_TOO_LARGE')) return { title: '미리보기를 지원하지 않는 원본입니다', description: `저장 형식이나 크기가 미리보기 범위를 벗어났습니다. 분류 코드 ${code}.`, retryable: false }
  if (status === 503 && code === 'STORAGE_UNAVAILABLE') return { title: '원본 저장소에 연결하지 못했습니다', description: `잠시 후 다시 시도해 주세요. ${notVerified}`, retryable: true }
  if (status === 503 && code === 'EVIDENCE_CONTENT_BUSY') return { title: '원본 열람 요청이 많습니다', description: `동시에 처리할 수 있는 열람 수를 넘었습니다. 잠시 후 다시 시도해 주세요. ${notVerified}`, retryable: true }
  if (status === 503 && code === 'AUDIT_UNAVAILABLE') return { title: '열람 기록을 저장하지 못해 원본을 표시하지 않았습니다', description: `서버가 열람 기록을 남기지 못하면 원본을 보내지 않습니다. 잠시 후 다시 시도해 주세요. ${notVerified}`, retryable: true }
  if (status === 400) return { title: '요청 값이 올바르지 않습니다', description: '제보 또는 증거 ID 형식이 올바르지 않습니다.', retryable: false }
  // 409 TENANT_SELECTION_REQUIRED, 503 DEPENDENCY_UNAVAILABLE 등은 기존 관리자 조회 문구를 그대로 쓴다.
  return { ...describeAdminApiFailure(failure, ''), retryable: status >= 500 }
}

const displayFailure: Message = {
  title: '이미지를 표시하지 못했습니다',
  description: `브라우저가 받은 이미지를 해석하지 못했습니다. 손상되었거나 지원하지 않는 이미지 구조일 수 있습니다. ${notVerified}`,
  retryable: true,
}

function previewBlockReason(evidence: FanReportEvidence) {
  if (!evidence.originalStored || evidence.storageStatus !== 'STORED') return '원본 저장이 확인되지 않아 미리볼 수 없습니다.'
  if (!evidenceImageMediaTypes.some((type) => type === evidence.mediaType)) return 'PNG 또는 JPEG가 아닌 원본은 미리볼 수 없습니다.'
  return null
}

export function EvidenceContentPreview({ fanReportId, evidence, evidenceLabel }: { fanReportId: string; evidence: FanReportEvidence; evidenceLabel: string }) {
  const client = useAdminApiClient()
  const { state } = useAdminAuth()
  const authenticated = state.status === 'authenticated'
  const blockReason = previewBlockReason(evidence)
  const path = blockReason === null ? evidenceContentPath(fanReportId, evidence.evidenceId) : null

  // 열 때마다 시도 번호를 올려 다시 연 미리보기가 이전 결과를 재사용하지 않게 한다.
  const [attempt, setAttempt] = useState(0)
  const [open, setOpen] = useState(false)
  const [settled, setSettled] = useState<Settled | null>(null)
  const [display, setDisplay] = useState<{ key: string; status: 'displayed' | 'failed' } | null>(null)
  const key = open && path !== null && authenticated ? `${attempt}:${path}` : null
  const expectedMediaType = evidence.mediaType

  useEffect(() => {
    if (key === null || path === null) return
    const controller = new AbortController()
    let objectUrl: string | null = null
    client.requestImage(path, { signal: controller.signal }).then((result) => {
      // 취소된 요청이 늦게 끝나도 현재 요청이 아니므로 Blob URL을 만들거나 표시하지 않는다.
      if (controller.signal.aborted) return
      if (result.kind !== 'success') {
        setSettled({ key, kind: 'failure', failure: result })
      } else if (result.data.mediaType !== expectedMediaType) {
        // 상세 응답의 증거 형식과 다른 이미지는 다른 원본일 수 있으므로 표시하지 않는다.
        setSettled({ key, kind: 'failure', failure: { kind: 'invalidResponse', status: result.status } })
      } else {
        objectUrl = URL.createObjectURL(result.data.blob)
        setSettled({ key, kind: 'image', url: objectUrl, byteSize: result.data.byteSize })
      }
    }, () => {
      if (!controller.signal.aborted) setSettled({ key, kind: 'failure', failure: { kind: 'problem', status: 400, code: 'CLIENT_REJECTED_PATH' } })
    })
    // 닫기, 다시 불러오기, 증거와 제보 변경, 로그아웃, 세션 만료, 언마운트 모두 이 정리로 요청을 중단하고 Blob URL을 해제한다.
    return () => {
      controller.abort()
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl)
    }
  }, [client, path, key, expectedMediaType])

  const current = key !== null && settled?.key === key ? settled : null
  const displayStatus = current?.kind === 'image' && display?.key === key ? display.status : null
  const start = () => {
    setSettled(null)
    setDisplay(null)
    setAttempt((value) => value + 1)
    setOpen(true)
  }
  const close = () => {
    setOpen(false)
    setSettled(null)
    setDisplay(null)
  }

  let previewState: string
  let body: ReactNode
  if (blockReason !== null) {
    previewState = 'unavailable'
    body = <><p className={styles.previewUnavailable}>{blockReason}</p><div className={styles.previewActions}><Button size="small" disabled>원본 미리보기</Button></div></>
  } else if (key === null) {
    previewState = 'closed'
    body = <div className={styles.previewActions}><Button size="small" onClick={start}>원본 미리보기</Button></div>
  } else if (current === null) {
    previewState = 'loading'
    body = <><LoadingSkeleton label="원본 이미지를 불러오는 중" /><div className={styles.previewActions}><Button variant="secondary" size="small" onClick={close}>미리보기 닫기</Button></div></>
  } else if (current.kind === 'failure' || displayStatus === 'failed') {
    previewState = current.kind === 'failure' ? 'failed' : 'displayFailed'
    const message = current.kind === 'failure' ? describeEvidenceContentFailure(current.failure) : displayFailure
    body = <><ErrorState title={message.title} description={message.description} onRetry={message.retryable ? start : undefined} /><div className={styles.previewActions}><Button variant="secondary" size="small" onClick={close}>미리보기 닫기</Button></div></>
  } else {
    const { url, byteSize } = current
    previewState = displayStatus === 'displayed' ? 'displayed' : 'decoding'
    body = <>
      <figure className={styles.previewFrame}>
        <img
          src={url}
          alt={`팬이 제출한 원본 이미지 (${evidenceLabel})`}
          onLoad={() => setDisplay({ key, status: 'displayed' })}
          onError={() => {
            // 해석하지 못한 이미지는 바로 해제한다. effect 정리에서 한 번 더 해제해도 문제가 없다.
            URL.revokeObjectURL(url)
            setDisplay({ key, status: 'failed' })
          }}
        />
        <figcaption>{expectedMediaType}, {formatBytes(byteSize)}. 실제 이미지 비율로 표시합니다.</figcaption>
      </figure>
      <div className={styles.previewActions}>
        <Button variant="secondary" size="small" onClick={start}>다시 불러오기</Button>
        <Button variant="secondary" size="small" onClick={close}>미리보기 닫기</Button>
      </div>
    </>
  }

  return <section className={styles.originalPreview} aria-label="원본 이미지 미리보기" data-preview-state={previewState}>
    <div className={styles.panelHeading}><h3>원본 이미지 미리보기</h3><span>{evidenceLabel}, 증거 ID <span className={styles.idCell}>{evidence.evidenceId}</span></span></div>
    <p className={styles.caution}>팬이 제출한 원본 자료입니다. 사실 확인이나 부정 거래 판정을 거친 자료가 아닙니다.</p>
    {body}
    <p className={styles.subtleNote}>버튼을 누른 증거 하나만 서버에서 받아 이 화면에서만 표시합니다. 열람 기록은 서버가 남깁니다. 다운로드는 지원하지 않습니다.</p>
  </section>
}
