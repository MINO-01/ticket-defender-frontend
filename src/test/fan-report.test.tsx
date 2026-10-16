import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'

const createObjectURL = vi.fn(() => `blob:preview-${createObjectURL.mock.calls.length}`)
const revokeObjectURL = vi.fn()
const originalCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
const originalRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')

beforeEach(() => {
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
})

afterEach(() => {
  if (originalCreate) Object.defineProperty(URL, 'createObjectURL', originalCreate)
  else delete (URL as { createObjectURL?: typeof URL.createObjectURL }).createObjectURL
  if (originalRevoke) Object.defineProperty(URL, 'revokeObjectURL', originalRevoke)
  else delete (URL as { revokeObjectURL?: typeof URL.revokeObjectURL }).revokeObjectURL
  createObjectURL.mockClear()
  revokeObjectURL.mockClear()
})

function renderRoute(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)
}

function image(name = 'evidence.png') {
  return new File(['image'], name, { type: 'image/png' })
}

function completeRequiredFields() {
  fireEvent.change(screen.getByRole('combobox', { name: /공연 선택/ }), { target: { value: 'DEMO_AUTUMN_LIVE' } })
  fireEvent.change(screen.getByLabelText(/공연 일시 또는 회차/), { target: { value: '2026-10-15T18:00' } })
  fireEvent.click(screen.getByRole('radio', { name: '고액 재판매 정황' }))
  fireEvent.change(screen.getByRole('textbox', { name: /의심 거래 설명/ }), { target: { value: '공연 티켓을 정가보다 높은 가격에 판매한다는 게시글을 보았습니다.' } })
}

describe('팬 제보 UI', () => {
  it('안내에서 작성 화면으로 이동하고 입력 오류를 수정할 수 있다', async () => {
    renderRoute('/fan/guide')
    fireEvent.click(screen.getByRole('link', { name: /제보 작성 시작/ }))
    expect(screen.getByRole('heading', { name: '제보 내용 작성' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '다음 단계: 최종 확인' }))
    expect(await screen.findByText('공연을 선택해 주세요.')).toBeInTheDocument()
    expect(screen.getByText('제보 유형을 선택해 주세요.')).toBeInTheDocument()
    completeRequiredFields()
    await waitFor(() => expect(screen.queryByText('공연을 선택해 주세요.')).not.toBeInTheDocument())
    fireEvent.change(screen.getByRole('textbox', { name: /관련 URL/ }), { target: { value: 'not-a-url' } })
    fireEvent.click(screen.getByRole('button', { name: '다음 단계: 최종 확인' }))
    expect(await screen.findByText('http 또는 https로 시작하는 주소를 입력해 주세요.')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: /관련 URL/ }), { target: { value: 'https://example.com/report' } })
    await waitFor(() => expect(screen.queryByText('http 또는 https로 시작하는 주소를 입력해 주세요.')).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '다음 단계: 최종 확인' }))
    expect(await screen.findByRole('heading', { name: '제보 내용 요약' })).toBeInTheDocument()
    expect(screen.getByText(/선택한 파일이 없습니다/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '제보 제출 준비 중' })).toBeDisabled()
  })

  it('확인 화면에서 돌아와도 입력과 파일이 유지되며 접수는 되지 않는다', async () => {
    renderRoute('/fan/write')
    completeRequiredFields()
    fireEvent.change(screen.getByLabelText('사진 선택하기'), { target: { files: [image()] } })
    expect(screen.getByAltText('evidence.png 미리보기')).toHaveAttribute('src', 'blob:preview-1')
    fireEvent.click(screen.getByRole('button', { name: '다음 단계: 최종 확인' }))
    expect(await screen.findByRole('heading', { name: '제보 내용 요약' })).toBeInTheDocument()
    expect(screen.getByText('evidence.png')).toBeInTheDocument()
    expect(screen.getByAltText('evidence.png 미리보기')).toBeInTheDocument()
    expect(screen.getByText('5 B')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '제보 제출 준비 중' })).toBeDisabled()
    fireEvent.click(screen.getByRole('link', { name: '내용 수정하기' }))
    expect(screen.getByRole('combobox', { name: /공연 선택/ })).toHaveValue('DEMO_AUTUMN_LIVE')
    expect(screen.getByRole('textbox', { name: /의심 거래 설명/ })).toHaveValue('공연 티켓을 정가보다 높은 가격에 판매한다는 게시글을 보았습니다.')
    expect(screen.getByAltText('evidence.png 미리보기')).toBeInTheDocument()
  })

  it('지원하지 않는 파일·크기·개수 오류를 알리고 제거와 URL 해제를 수행한다', async () => {
    const view = renderRoute('/fan/write')
    const picker = screen.getByLabelText('사진 선택하기')
    fireEvent.change(picker, { target: { files: [new File(['pdf'], 'a.pdf', { type: 'application/pdf' })] } })
    expect(screen.getByRole('alert')).toHaveTextContent('JPEG 또는 PNG')
    fireEvent.change(picker, { target: { files: [new File([], 'empty.png', { type: 'image/png' })] } })
    expect(screen.getByRole('alert')).toHaveTextContent('비어 있는 파일')
    expect(createObjectURL).not.toHaveBeenCalled()
    const large = image('large.png')
    Object.defineProperty(large, 'size', { value: 20 * 1024 * 1024 + 1 })
    fireEvent.change(picker, { target: { files: [large] } })
    expect(screen.getByRole('alert')).toHaveTextContent('20MB')
    fireEvent.change(picker, { target: { files: Array.from({ length: 6 }, (_, index) => image(`file-${index}.png`)) } })
    expect(screen.getByRole('alert')).toHaveTextContent('최대 5개')
    expect(screen.getAllByRole('button', { name: /\.png 제거/ })).toHaveLength(5)
    fireEvent.click(screen.getByRole('button', { name: 'file-0.png 제거' }))
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview-1')
    view.unmount()
    expect(revokeObjectURL).toHaveBeenCalledTimes(5)
  })

  it('선택을 취소한 뒤 같은 파일을 다시 선택할 수 있다', () => {
    renderRoute('/fan/write')
    const picker = screen.getByLabelText('사진 선택하기') as HTMLInputElement
    const selected = image('again.png')
    fireEvent.change(picker, { target: { files: [selected] } })
    expect(picker).toHaveValue('')
    fireEvent.click(screen.getByRole('button', { name: 'again.png 제거' }))
    fireEvent.change(picker, { target: { files: [selected] } })
    expect(screen.getByAltText('again.png 미리보기')).toBeInTheDocument()
    expect(createObjectURL).toHaveBeenCalledTimes(2)
  })

  it('이미지 표시 실패를 알리고 제보 유형 변경 시 숨긴 가격 오류를 해제한다', async () => {
    renderRoute('/fan/write')
    fireEvent.change(screen.getByLabelText('사진 선택하기'), { target: { files: [image()] } })
    fireEvent.error(screen.getByAltText('evidence.png 미리보기'))
    expect(screen.getByRole('alert')).toHaveTextContent('미리보기를 표시할 수 없습니다')
    fireEvent.click(screen.getByRole('radio', { name: '고액 재판매 정황' }))
    fireEvent.change(screen.getByRole('textbox', { name: /제시된 판매 가격/ }), { target: { value: '가격 미상' } })
    fireEvent.click(screen.getByRole('button', { name: '다음 단계: 최종 확인' }))
    expect(await screen.findByText('가격은 0보다 큰 숫자로 입력해 주세요.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: '기타 의심 거래' }))
    expect(screen.queryByText('가격은 0보다 큰 숫자로 입력해 주세요.')).not.toBeInTheDocument()
  })

  it('새로 마운트하면 임시 입력이 초기화되고 이를 화면에 안내한다', () => {
    const first = renderRoute('/fan/write')
    fireEvent.change(screen.getByLabelText(/좌석 구역·등급/), { target: { value: '1층 A구역' } })
    first.unmount()
    renderRoute('/fan/write')
    expect(screen.getByLabelText(/좌석 구역·등급/)).toHaveValue('')
    expect(screen.getByText(/새로고침하거나 탭을 닫으면 사라지며/)).toBeInTheDocument()
  })

  it('조회 필수값을 검증하고 인증 전 상세 내용을 보여주지 않는다', async () => {
    renderRoute('/fan/lookup')
    fireEvent.click(screen.getByRole('button', { name: '입력 내용 확인' }))
    expect(await screen.findByText('접수번호를 입력해 주세요.')).toBeInTheDocument()
    expect(screen.getByText('조회 코드를 입력해 주세요.')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: /접수번호/ }), { target: { value: 'UNVERIFIED' } })
    fireEvent.change(screen.getByLabelText(/비밀 조회 코드/), { target: { value: 'arbitrary-code' } })
    fireEvent.click(screen.getByRole('button', { name: '입력 내용 확인' }))
    expect(await screen.findByRole('status')).toHaveTextContent('인증 API가 연결되지 않았습니다')
    expect(screen.queryByText('DEMO-ONLY-0001')).not.toBeInTheDocument()
  })

  it('일반 완료·상태 경로는 성공 또는 상세 데이터를 표시하지 않는다', () => {
    const complete = renderRoute('/fan/complete')
    expect(screen.getByText('아직 접수된 제보가 없습니다')).toBeInTheDocument()
    expect(screen.queryByText('DEMO-ONLY-0001')).not.toBeInTheDocument()
    complete.unmount()
    renderRoute('/fan/status')
    expect(screen.getByText('조회 인증이 필요합니다')).toBeInTheDocument()
    expect(screen.queryByText('DEMO-ONLY-0001')).not.toBeInTheDocument()
  })

  it('시연 화면은 합성 데이터임을 명확히 표시한다', () => {
    renderRoute('/fan/demo/complete')
    expect(screen.getByText(/개발 전용 · 합성 데모 데이터/)).toBeInTheDocument()
    expect(screen.getByText('DEMO-ONLY-0001')).toBeInTheDocument()
    expect(screen.getByText(/실제 접수번호 아님/)).toBeInTheDocument()
  })
})
