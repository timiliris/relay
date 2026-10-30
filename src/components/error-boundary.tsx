import { error as logError } from '@tauri-apps/plugin-log';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import i18n from '@/i18n';
import { isTauri } from '@/lib/tauri';
import { Button } from './ui/button';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Dernier filet de sécurité : affiche l'erreur au lieu d'un écran blanc. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Erreur non interceptée :', error, info.componentStack);
    if (isTauri()) {
      logError(`UI : ${error.message}
${error.stack ?? ''}
${info.componentStack ?? ''}`);
    }
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <main className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <h1 className="text-xl font-semibold">{i18n.t('errorBoundary.title')}</h1>
        <pre className="max-w-xl overflow-auto rounded-md bg-muted p-4 text-left text-xs text-destructive">
          {error.message}
        </pre>
        <Button onClick={() => this.setState({ error: null })}>
          {i18n.t('errorBoundary.retry')}
        </Button>
      </main>
    );
  }
}
