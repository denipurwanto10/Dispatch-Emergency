import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }
      return (
        <div className="error-boundary" style={{ padding: '24px', textAlign: 'center' }}>
          <h2 style={{ color: 'var(--danger)', marginBottom: '12px' }}>Terjadi Kesalahan</h2>
          <p style={{ color: 'var(--text-2)', marginBottom: '16px' }}>
            {this.state.error?.message ?? 'Terjadi kesalahan yang tidak terduga.'}
          </p>
          <pre style={{ textAlign: 'left', background: 'var(--surface-2)', padding: '12px', borderRadius: '8px', overflow: 'auto', fontSize: '0.75rem', color: 'var(--text-2)' }}>
            {this.state.error?.stack}
          </pre>
        </div>
      )
    }

    return this.props.children
  }
}