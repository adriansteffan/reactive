import { BaseComponentProps, ExperimentConfig } from './utils/common';

export type { BaseComponentProps, ExperimentConfig };

export * from './utils/array';
export * from './utils/common';
export * from './utils/simulation';
export { registerFlattener, arrayFlattener } from './utils/upload';
export { normal, poisson, uniform, seedDistributions, sobol, halton, sampleParticipants, draw } from './utils/distributions';
export { useTheme, ThemeContext, THEME, t, LIGHT_DOT_BG_CLASS, DARK_BG_CLASS, DARK_BG_PLAIN_CLASS } from './utils/theme';
export { AudioDeviceContext, useAudioDeviceId } from './utils/audiodevice';
export { textToWebmBase64, probeAudioDurationMs } from './utils/tts';
export { DUMMY_AUDIO_BASE64 } from './components/voicerecording';
export { invokeLLM } from './utils/llm';
export type { LLMConfig, LLMSchema } from './utils/llm';
export type { Theme } from './utils/theme';
export type { DimensionSpec, UniformSpec, NormalSpec, PoissonSpec, IntegerSpec, DiscreteSpec, SamplingMethod } from './utils/distributions';
export { simulateDDMTrial, mapDDMChoice } from './utils/ddm';
export type { DDMTrialParams, DDMTrialResult, ParameterDef, NormalDist, UniformDist, BoundaryDef, CollapseDef, PostStimStrategyDef, ContinueStrategy, CollapseStrategy, SnapshotStrategy } from './utils/ddm';
export * from './components';

export * from 'react-toastify';