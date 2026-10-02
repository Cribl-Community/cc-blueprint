import { Component, type ReactNode } from 'react';
import { Text } from '@capra/core';

interface State {
  error?: Error;
}

/** Shows a render error instead of a blank iframe, so a crash can be reported and diagnosed. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('Cribl Blueprint crashed while rendering', error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="app-error" role="alert">
        <Text as="h2" variant="heading">Blueprint hit an error</Text>
        <Text>Reload the page to try again. If it keeps happening, report this message:</Text>
        <pre className="app-error-detail">{`${error.name}: ${error.message}${error.stack ? `\n\n${error.stack}` : ''}`}</pre>
      </div>
    );
  }
}
