import { Component, type ReactNode } from 'react';
import Text from '../components/text';
import type { Experiment } from '../core/experiment';

/** Shows an error that stops the experiment, since React would leave the page empty. */
export class ErrorBoundary extends Component<
  { experiment: Experiment<any>; children: ReactNode },
  { message?: string }
> {
  state: { message?: string } = {};

  static getDerivedStateFromError(error: unknown) {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  componentDidUpdate(previous: { experiment: Experiment<any> }) {
    // A hot reload may have fixed the error
    if (this.state.message !== undefined && previous.experiment !== this.props.experiment) {
      this.setState({ message: undefined });
    }
  }

  render() {
    const { message } = this.state;
    if (message === undefined) return this.props.children;
    return (
      <Text
        content={
          <>
            <h1>Something went wrong</h1>
            <p>{message}</p>
          </>
        }
        buttonText=''
        next={() => {}}
      />
    );
  }
}
