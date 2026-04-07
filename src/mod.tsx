import { BaseComponentProps, ExperimentConfig } from './utils/common';

export type { BaseComponentProps, ExperimentConfig };

export * from './utils/array';
export * from './utils/common';
export * from './utils/simulation';
export { registerFlattener, arrayFlattener } from './utils/upload';
export { normal, poisson, uniform, seedDistributions, sobol, halton, sampleParticipants } from './utils/distributions';
export { useTheme, ThemeContext, THEME, t, DARK_BG_CLASS } from './utils/theme';
export type { Theme } from './utils/theme';
export type { DimensionSpec, UniformSpec, NormalSpec, PoissonSpec, SamplingMethod } from './utils/distributions';
export { simulateDDMTrial, mapDDMChoice } from './utils/ddm';
export type { DDMTrialParams, DDMTrialResult, ParameterDef, NormalDist, UniformDist, BoundaryDef, CollapseDef, PostStimStrategyDef, ContinueStrategy, CollapseStrategy, SnapshotStrategy } from './utils/ddm';
export * from './components';

export * from 'react-toastify';