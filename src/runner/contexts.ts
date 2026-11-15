import { createContext, useContext } from 'react';
import type { ParamSpec, ParamValues } from '../core/params';
import type { CompiledTimeline } from '../core/timeline';

const ParamsContext = createContext<Record<string, unknown>>({});
export const ParamsProvider = ParamsContext.Provider;

/**
 * The values of a component's own params, typed like the experiment's. Declare them `as const`
 * to type a param with `values` as one of them.
 */
export function useParams<const P extends Record<string, ParamSpec>>(params: P): ParamValues<P> {
  const values = useContext(ParamsContext);
  return Object.fromEntries(Object.keys(params).map((name) => [name, values[name]])) as ParamValues<P>;
}

/** The microphone chosen in MicrophoneCheck, which recordings use. */
export const AudioDeviceContext = createContext<string | undefined>(undefined);
export const useAudioDeviceId = () => useContext(AudioDeviceContext);

/** The compiled timeline of the run: Upload builds the CSV files from its components, and CanvasBlock reads its trials by name. */
export const CompiledTimelineContext = createContext<CompiledTimeline>({
  bytecode: { instructions: [], markers: {} },
  trials: new Set(),
  components: new Map(),
});
