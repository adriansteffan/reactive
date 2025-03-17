import { BaseComponentProps } from '../utils/common';
import { useEffect } from 'react';
import { StatusBar } from '@capacitor/status-bar';
import { NavigationBar } from '@hugotomazi/capacitor-navigation-bar';

function exitFullscreen() {

  StatusBar.show();
  NavigationBar.show();

  if (document.exitFullscreen) {
    document.exitFullscreen();
  } else if ((document as any).mozCancelFullScreen) {
    (document as any).mozCancelFullScreen();
  } else if ((document as any).webkitExitFullscreen) {
    (document as any).webkitExitFullscreen();
  } else if ((document as any).msExitFullscreen) {
    (document as any).msExitFullscreen();
  }
}

export default function ExitFullscreen({ next }: BaseComponentProps) {
  useEffect(() => {
    exitFullscreen();
    next({});
  }, []);

  return <></>;
}
