import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render errors so a single broken component does not leave the user
 * staring at a blank white page with no way to recover.
 */
class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled render error:', error, info.componentStack);
  }

  private handleReset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;

    if (!error) {
      return this.props.children;
    }

    return (
      <div className="bg-background flex min-h-dvh flex-col items-center justify-center gap-5 p-8 text-center">
        <div className="bg-destructive/10 rounded-2xl p-4">
          <TriangleAlert className="text-destructive h-8 w-8" />
        </div>

        <div className="max-w-md">
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            An unexpected error stopped this page from rendering. Trying again often clears it.
          </p>
          <pre className="bg-muted text-muted-foreground mt-4 max-h-32 overflow-auto rounded-lg p-3 text-left text-xs">
            {error.message}
          </pre>
        </div>

        <div className="flex gap-2">
          <Button onClick={this.handleReset}>
            <RefreshCw className="h-4 w-4" />
            Try again
          </Button>
          <Button variant="outline" onClick={() => window.location.assign('/')}>
            Go home
          </Button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
