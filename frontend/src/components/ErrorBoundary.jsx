import React from 'react';
import { AlertTriangle, RotateCcw } from './icons/ThemeIcons';
import { isDynamicImportError, tryRecoverFromChunkError } from '../utils/chunkLoadRecovery';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    if (tryRecoverFromChunkError(error)) {
      return;
    }
    console.error('ChroniX UI caught an unexpected error:', error, errorInfo);
  }

  handleReset = () => {
    if (isDynamicImportError(this.state.error)) {
      if (typeof window !== 'undefined' && window.location) {
        window.location.reload();
        return;
      }
    }
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.handleReset);
      }

      const isChunkError = isDynamicImportError(this.state.error);

      return (
        <div className="flex flex-col items-center justify-center p-6 text-center bg-surface-raised border border-line rounded-sheet m-4 text-ink shadow-panel">
          <div className="w-12 h-12 rounded-full bg-danger-soft flex items-center justify-center mb-3 text-danger">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-semibold mb-1">
            {isChunkError ? 'A newer version of ChroniX is available' : 'Something went wrong rendering this item'}
          </h3>
          <p className="text-xs text-ink-muted mb-4 max-w-sm">
            {isChunkError
              ? 'Please reload the page to load the latest application files.'
              : (this.state.error?.message || 'An unexpected display error occurred.')}
          </p>
          <button
            type="button"
            onClick={this.handleReset}
            className="flex items-center gap-2 px-3 py-2 rounded-control bg-danger text-white hover:opacity-90 text-xs font-medium shadow-control transition-opacity cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>{isChunkError ? 'Reload Page' : 'Try Again'}</span>
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
