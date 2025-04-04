import 'react-toastify/dist/ReactToastify.min.css';
import { ToastContainer } from 'react-toastify';

const queryClient = new QueryClient();
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode } from 'react';
import { SettingsScreen } from './settingsscreen';
import { Param } from '../utils/common';

export default function ExperimentProvider({ children, disableSettings }: { children: ReactNode, disableSettings?: boolean }) {
 
  if (window.location.pathname.endsWith('/settings') && !disableSettings) {
    return (
      <SettingsScreen
        paramRegistry={Param.getRegistry()}
        timelineRepresentation={Param.getTimelineRepresentation()}
      />
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      {children}
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
