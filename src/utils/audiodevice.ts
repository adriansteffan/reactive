import { createContext, useContext } from 'react';

export const AudioDeviceContext = createContext<string | undefined>(undefined);
export const useAudioDeviceId = () => useContext(AudioDeviceContext);
