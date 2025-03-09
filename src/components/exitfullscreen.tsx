import { BaseComponentProps } from '../utils/common';
import { useEffect } from 'react';

function exitFullscreen() {
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
