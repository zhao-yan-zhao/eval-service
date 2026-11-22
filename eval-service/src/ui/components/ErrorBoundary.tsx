import React, { Component, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary caught error]:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="m-4 rounded-lg border border-rose-500/40 bg-[#161b22] p-6 text-slate-100 shadow-xl">
          <div className="flex items-center gap-3 text-rose-400">
            <AlertTriangle className="h-6 w-6 shrink-0" />
            <h3 className="text-base font-semibold">
              {this.props.fallbackTitle || '界面渲染遇到异常'}
            </h3>
          </div>
          <p className="mt-2 text-xs text-[#8b949e]">
            {this.state.error?.message || '发生未知渲染错误'}
          </p>
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              重新载入界面
            </button>
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, error: null })}
              className="rounded-md border border-[#30363d] px-3 py-1.5 text-xs text-slate-300 transition hover:bg-[#21262d]"
            >
              尝试恢复当前视图
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
