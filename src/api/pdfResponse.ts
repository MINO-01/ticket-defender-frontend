// 관리자 공식 PDF 다운로드 응답의 형식을 확인한다.
// 주된 무결성 기준은 화면이 발급 상세의 pdfSha256, pdfSize와 실제 바이트를 비교하는 것이고, 여기의 서명과 끝 표시 검사는 보조 검사다.
// 200 HTML 로그인 화면이나 JSON 오류 본문을 PDF로 저장하지 않기 위한 최소 확인이며 PDF 전체 구조를 검증하지 않는다.

/** Frontend 임시 상한이다. Backend 계약에는 최대 크기가 없으며 Backend가 확정한 값이 아니다. */
export const maxOfficialPdfBytes = 20 * 1024 * 1024

const pdfSignature = [0x25, 0x50, 0x44, 0x46, 0x2d] // %PDF-
const eofMarker = [0x25, 0x25, 0x45, 0x4f, 0x46] // %%EOF
// 끝 표시 뒤의 정상적인 개행이나 공백을 허용하도록 마지막 1024바이트 안에서 찾는다.
const eofSearchWindow = 1024

/** Content-Type에서 매개변수를 뺀 형식이 application/pdf인지 확인한다. */
export function isPdfContentType(value: string | null) {
  return value?.split(';')[0].trim().toLowerCase() === 'application/pdf'
}

function matchesAt(bytes: Uint8Array, expected: number[], offset: number) {
  return expected.every((value, index) => bytes[offset + index] === value)
}

/** %PDF- 서명으로 시작하고 끝부분에 %%EOF가 있는지 확인한다. */
export function looksLikePdf(bytes: Uint8Array) {
  if (bytes.length < pdfSignature.length + eofMarker.length || !matchesAt(bytes, pdfSignature, 0)) return false
  const start = Math.max(0, bytes.length - eofSearchWindow)
  for (let offset = bytes.length - eofMarker.length; offset >= start; offset--) {
    if (matchesAt(bytes, eofMarker, offset)) return true
  }
  return false
}
