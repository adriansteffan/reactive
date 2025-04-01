import React from 'react';
import ReactDOM from 'react-dom/client';
import '@adriansteffan/reactive/style.css';
import './index.css';
import { ExperimentProvider, ExperimentRunner, ExperimentConfig } from '@adriansteffan/reactive';

import { experiment } from './Experiment';
import * as ExperimentModule from './Experiment';

const Experiment = () => {
  const experimentConfig =
    'config' in ExperimentModule ? (ExperimentModule.config as ExperimentConfig) : undefined;

  const experimentComponents =
    'components' in ExperimentModule
      ? (ExperimentModule.components as Record<string, React.ComponentType<any>>)
      : undefined;

  const experimentQuestions =
    'questions' in ExperimentModule
      ? (ExperimentModule.questions as Record<string, React.ComponentType<any>>)
      : undefined;

  return (
    <ExperimentRunner
      timeline={experiment}
      config={experimentConfig}
      components={experimentComponents}
      questions={experimentQuestions}
    />
  );
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ExperimentProvider>
      <Experiment />
    </ExperimentProvider>
  </React.StrictMode>,
);
