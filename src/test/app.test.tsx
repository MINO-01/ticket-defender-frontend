import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import App from '../App'
import { Button } from '../components/common/Button'
import { Input } from '../components/common/FormControls'
import { StatusBadge } from '../components/common/StatusBadge'

function renderRoute(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)
}

describe('주요 화면 경로', () => {
  it('관리자 화면에는 관리자 메뉴와 본문을 표시한다', () => {
    renderRoute('/app/overview')
    expect(screen.getByRole('navigation', { name: '관리자 탐색' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '전체 현황' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: '팬 제보 탐색' })).not.toBeInTheDocument()
  })

  it('팬 제보 화면에는 단계와 하단 탐색을 표시한다', () => {
    renderRoute('/fan/guide')
    expect(screen.getByRole('heading', { name: '제보 안내' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: '제보 진행 단계' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: '팬 제보 탐색' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: '관리자 탐색' })).not.toBeInTheDocument()
  })

  it('인증 전 제보 상태 경로에는 상세 정보를 표시하지 않는다', () => {
    renderRoute('/fan/status')
    expect(screen.getByRole('heading', { name: '내 제보 상태' })).toBeInTheDocument()
    expect(screen.getByText(/인증이 완료되기 전에는/)).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('보고서 센터에서 공식 PDF 발급이 비활성화되었음을 알린다', () => {
    renderRoute('/app/report-center')
    expect(screen.getByRole('heading', { name: '공식 PDF 발급은 비활성화되어 있습니다' })).toBeInTheDocument()
  })
})

describe('공통 컴포넌트', () => {
  it('Button의 로딩 상태에서는 작업을 다시 누를 수 없다', () => {
    render(<Button loading variant="secondary" size="large">저장</Button>)
    const button = screen.getByRole('button', { name: '저장' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
  })

  it('Button의 disabled 상태를 전달한다', () => {
    render(<Button disabled>확인</Button>)
    expect(screen.getByRole('button', { name: '확인' })).toBeDisabled()
  })

  it('업무 상태를 한국어 라벨로 표시한다', () => {
    render(<><StatusBadge domain="job" status="FAILED" /><StatusBadge domain="case" status="NEEDS_EVIDENCE" /></>)
    expect(screen.getByText('실패')).toBeInTheDocument()
    expect(screen.getByText('추가 자료 필요')).toBeInTheDocument()
  })

  it('입력 오류를 필드에 연결한다', () => {
    render(<Input label="이름" error="이름을 입력해 주세요" required />)
    const input = screen.getByRole('textbox', { name: /이름/ })
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(within(screen.getByText('이름을 입력해 주세요').parentElement!).getByText('이름을 입력해 주세요')).toBeInTheDocument()
    expect(input.getAttribute('aria-describedby')).toBe(screen.getByText('이름을 입력해 주세요').id)
  })
})
