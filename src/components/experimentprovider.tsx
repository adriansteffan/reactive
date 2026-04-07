import 'react-toastify/dist/ReactToastify.min.css';
import { ToastContainer } from 'react-toastify';

const queryClient = new QueryClient();
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, ReactNode, useContext, useEffect } from 'react';
import { SettingsScreen } from './settingsscreen';
import { Param } from '../utils/common';

const HybridSimulationContext = createContext(false);
export const useHybridSimulationDisabled = () => useContext(HybridSimulationContext);

function parseBooleanProp(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase();
    return lower !== '' && lower !== 'false' && lower !== '0';
  }
  return !!value;
}

export default function ExperimentProvider({ children, disableSettings, disableHybridSimulation }: { children: ReactNode, disableSettings?: boolean, disableHybridSimulation?: boolean }) {

  useEffect(() => {
    const preventSpaceScroll = (e: KeyboardEvent) => {
      if (e.key === ' ' &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement) &&
        !(e.target as HTMLElement).isContentEditable) {
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', preventSpaceScroll);
    return () => window.removeEventListener('keydown', preventSpaceScroll);
  }, []);

  if (window.location.pathname.endsWith('/settings') && !parseBooleanProp(disableSettings)) {
    return (
      <SettingsScreen
        paramRegistry={Param.getRegistry()}
        timelineRepresentation={Param.getTimelineRepresentation()}
      />
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <HybridSimulationContext.Provider value={parseBooleanProp(disableHybridSimulation)}>
      {children}
      </HybridSimulationContext.Provider>
      <ToastContainer
        position='top-center'
        autoClose={3000}
        hideProgressBar
        newestOnTop={false}
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable={false}
        pauseOnHover
        theme='light'
        toastClassName={() =>
          'relative flex p-4 min-h-10 rounded-none justify-between overflow-hidden cursor-pointer border-2 border-black shadow-[2px_2px_0px_rgba(0,0,0,1)] bg-white'
        }
        bodyClassName='text-black font-sans'
      />
    </QueryClientProvider>
  );
}
