// 관리자 증거 원본 이미지 응답을 읽고 형식을 확인한다.
// Backend가 크기, 형식, SHA-256을 검증하지만 Frontend도 상한을 넘는 본문을 읽지 않고, PNG나 JPEG가 아닌 응답을 이미지로 표시하지 않는다.
// 헤더 검사는 이미지 전체가 정상 디코딩된다는 뜻이 아니므로 화면에서 img 표시 실패도 따로 처리한다.

/** Backend admin-evidence-content-v1의 최대 크기 기본값 및 상한과 같은 20 MiB */
export const maxEvidenceImageBytes = 20 * 1024 * 1024

export const evidenceImageMediaTypes = ['image/png', 'image/jpeg'] as const
export type EvidenceImageMediaType = (typeof evidenceImageMediaTypes)[number]

const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
// PNG 서명 뒤 첫 청크는 길이 13의 IHDR이어야 한다.
const pngIhdr = [0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]

function startsWith(bytes: Uint8Array, expected: number[], offset = 0) {
  return bytes.length >= offset + expected.length && expected.every((value, index) => bytes[offset + index] === value)
}

/** 바이트 서명과 최소 구조로 PNG 또는 JPEG를 판별한다. 어느 쪽도 아니면 null이다. */
export function detectImageMediaType(bytes: Uint8Array): EvidenceImageMediaType | null {
  // 서명 8바이트, IHDR 길이와 이름 8바이트, IHDR 데이터 13바이트, CRC 4바이트
  if (bytes.length >= 33 && startsWith(bytes, pngSignature) && startsWith(bytes, pngIhdr, 8)) return 'image/png'
  // SOI(FFD8) 바로 뒤에 다음 마커(FF)가 이어져야 한다. 잘린 JPEG는 화면의 img 표시 실패로 따로 처리한다.
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  return null
}

/** Content-Type에서 매개변수를 뺀 형식만 읽어 PNG 또는 JPEG일 때만 반환한다. */
export function readImageContentType(value: string | null): EvidenceImageMediaType | null {
  const mediaType = value?.split(';')[0].trim().toLowerCase()
  return evidenceImageMediaTypes.find((type) => type === mediaType) ?? null
}

/** Content-Length가 없으면 undefined, 형식이 잘못되었으면 null을 반환한다. */
function readContentLength(value: string | null) {
  if (value === null) return undefined
  return /^(0|[1-9][0-9]{0,15})$/.test(value.trim()) ? Number(value.trim()) : null
}

/**
 * 응답 본문을 최대 maxBytes까지만 읽는다. 상한을 넘거나 Content-Length와 실제 크기가 다르면 스트림을 중단하고 null을 반환한다.
 * response.blob()처럼 끝까지 읽은 뒤 크기를 확인하지 않는다.
 */
export async function readLimitedBody(response: Response, maxBytes = maxEvidenceImageBytes): Promise<Uint8Array<ArrayBuffer> | null> {
  const declared = readContentLength(response.headers.get('Content-Length'))
  const body = response.body
  if (declared === null || (declared !== undefined && declared > maxBytes)) {
    await body?.cancel().catch(() => undefined)
    return null
  }
  if (!body) return null

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes || (declared !== undefined && total > declared)) {
        await reader.cancel().catch(() => undefined)
        return null
      }
      chunks.push(value)
    }
  } catch {
    // 수신 중 연결이 끊기거나 요청이 취소된 본문은 일부만 표시하지 않는다.
    await reader.cancel().catch(() => undefined)
    return null
  }
  if (declared !== undefined && total !== declared) return null

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}
