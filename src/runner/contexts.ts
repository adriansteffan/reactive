import { createContext, useContext } from 'react';
import { report } from '../core/development';
import type { CheckedParams, ParamSpec, ParamValues } from '../core/params';
import type { CompiledTimeline } from '../core/timeline';

// The run's params, or undefined for a component rendered outside a run
const ParamsContext = createContext<Record<string, unknown> | undefined>(undefined);
export const ParamsProvider = ParamsContext.Provider;

/**
 * The values of a component's own params, typed like the experiment's. Declare them `as const`
 * to type a param with `values` as one of them, and pass the same params to `defineComponent`.
 */
export function useParams<const P extends Record<string, ParamSpec>>(params: CheckedParams<P>): ParamValues<P> {
  const values = useContext(ParamsContext);
  for (const name of Object.keys(params)) {
    if (values && !(name in values)) {
      report(
        `useParams reads the param '${name}', which neither the experiment nor a component in the timeline declares, so it has no value and the settings screen does not list it. Pass the same params to the component's defineComponent.`,
      );
    }
  }
  return Object.fromEntries(Object.keys(params).map((name) => [name, values?.[name]])) as ParamValues<P>;
}

/** The microphone chosen in MicrophoneCheck, which recordings use. */
export const AudioDeviceContext = createContext<string | undefined>(undefined);
export const useAudioDeviceId = () => useContext(AudioDeviceContext);

/** The compiled timeline of the run: Upload builds the CSV files from its components, and CanvasBlock reads its trials by name. */
export const CompiledTimelineContext = createContext<CompiledTimeline>({
  bytecode: { instructions: [], markers: {}, fullscreen: [] },
  trials: new Set(),
  components: new Map(),
});
