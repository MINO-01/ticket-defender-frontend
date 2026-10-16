import { Component } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ErrorState } from '../../components/common/Feedback'

export class AdminRouteErrorBoundary extends Component<{ children: ReactNode; backTo: string; backLabel: string }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed) return <div><ErrorState title="조사 화면을 열지 못했습니다" description="화면을 다시 열거나 잠시 후 시도해 주세요." /><Link to={this.props.backTo}>{this.props.backLabel}</Link></div>
    return this.props.children
  }
}
