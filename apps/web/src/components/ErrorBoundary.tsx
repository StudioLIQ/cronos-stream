import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  handleCopyDiagnostics = (): void => {
    const { error, errorInfo } = this.state;
    const diagnostics = this.generateDiagnostics(error, errorInfo);
    navigator.clipboard.writeText(diagnostics).then(() => {
      alert('Diagnostics copied to clipboard!');
    });
  };

  handleReload = (): void => {
    window.location.reload();
  };

  handleGoHome = (): void => {
    window.location.href = '/';
  };

  generateDiagnostics(error: Error | null, errorInfo: ErrorInfo | null): string {
    const lines: string[] = [
      '=== Stream402 Error Diagnostics ===',
      '',
      `Timestamp: ${new Date().toISOString()}`,
      `URL: ${window.location.href}`,
      `User Agent: ${navigator.userAgent}`,
      '',
      '--- Error ---',
      `Name: ${error?.name || 'Unknown'}`,
      `Message: ${error?.message || 'No message'}`,
      '',
      '--- Stack Trace ---',
      error?.stack || 'No stack trace available',
      '',
      '--- Component Stack ---',
      errorInfo?.componentStack || 'No component stack available',
      '',
      '--- Environment ---',
      `Network: ${(navigator as Navigator & { connection?: { effectiveType?: string } }).connection?.effectiveType || 'Unknown'}`,
      `Language: ${navigator.language}`,
      `Online: ${navigator.onLine}`,
    ];

    return lines.join('\n');
  }

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const { error, errorInfo } = this.state;

      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            background: 'var(--bg, #0b0f14)',
            color: 'var(--text, #e5e7eb)',
          }}
        >
          <div
            style={{
              maxWidth: '600px',
              width: '100%',
              background: 'var(--panel, #111827)',
              border: '1px solid var(--border, rgba(255,255,255,0.08))',
              borderRadius: '14px',
              padding: '32px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
              <span style={{ fontSize: '36px' }}>&#9888;</span>
              <h1 style={{ fontSize: '24px', fontWeight: 700 }}>Something went wrong</h1>
            </div>

            <p style={{ color: 'var(--muted, #9ca3af)', lineHeight: 1.6, marginBottom: '20px' }}>
              The application encountered an unexpected error. You can try reloading the page or going back to the home page.
            </p>

            {error && (
              <div
                style={{
                  background: 'var(--panel-2, #0f172a)',
                  border: '1px solid var(--border, rgba(255,255,255,0.08))',
                  borderRadius: '8px',
                  padding: '16px',
                  marginBottom: '20px',
                }}
              >
                <p style={{ fontWeight: 600, marginBottom: '8px', color: 'var(--danger, #e02020)' }}>{error.name}</p>
                <p style={{ fontSize: '14px', color: 'var(--muted, #9ca3af)', wordBreak: 'break-word' }}>
                  {error.message}
                </p>
              </div>
            )}

            <details
              style={{
                marginBottom: '20px',
                background: 'var(--panel-2, #0f172a)',
                border: '1px solid var(--border, rgba(255,255,255,0.08))',
                borderRadius: '8px',
                padding: '12px',
              }}
            >
              <summary
                style={{
                  cursor: 'pointer',
                  fontWeight: 500,
                  fontSize: '14px',
                  color: 'var(--muted, #9ca3af)',
                }}
              >
                Technical Details
              </summary>
	              <pre
	                style={{
	                  marginTop: '12px',
	                  padding: '12px',
	                  background: 'var(--code-bg, rgba(0,0,0,0.3))',
	                  borderRadius: '6px',
	                  fontSize: '12px',
	                  overflow: 'auto',
	                  maxHeight: '200px',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {error?.stack}
              </pre>
              {errorInfo?.componentStack && (
	                <pre
	                  style={{
	                    marginTop: '8px',
	                    padding: '12px',
	                    background: 'var(--code-bg, rgba(0,0,0,0.3))',
	                    borderRadius: '6px',
	                    fontSize: '12px',
	                    overflow: 'auto',
	                    maxHeight: '200px',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {errorInfo.componentStack}
                </pre>
              )}
            </details>

            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
	              <button
	                onClick={this.handleReload}
	                style={{
	                  padding: '12px 24px',
	                  background: 'var(--primary, #00f889)',
	                  color: 'var(--primary-text, #0e0f10)',
	                  border: 'none',
	                  borderRadius: '8px',
	                  fontWeight: 600,
	                  cursor: 'pointer',
	                }}
	              >
                Reload Page
              </button>
              <button
                onClick={this.handleGoHome}
                style={{
                  padding: '12px 24px',
                  background: 'transparent',
                  color: 'var(--text, #e5e7eb)',
                  border: '1px solid var(--border, rgba(255,255,255,0.08))',
                  borderRadius: '8px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Go to Home
              </button>
              <button
                onClick={this.handleCopyDiagnostics}
                style={{
                  padding: '12px 24px',
                  background: 'transparent',
                  color: 'var(--muted, #9ca3af)',
                  border: '1px solid var(--border, rgba(255,255,255,0.08))',
                  borderRadius: '8px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Copy Diagnostics
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
