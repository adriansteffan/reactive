import { BaseComponentProps } from '../utils/common';
import Text from '../components/text';

import { StatusBar } from '@capacitor/status-bar';
import { ImmersiveMode } from '@adriansteffan/immersive-mode';


function enterFullscreen(element: any) {
  
  // Android
  StatusBar.hide();
  ImmersiveMode.enable();

  if (element.requestFullscreen) {
    element.requestFullscreen();
  } else if (element.mozRequestFullScreen) {
    // Firefox
    element.mozRequestFullScreen();
  } else if (element.webkitRequestFullscreen) {
    // Chrome, Safari and Opera
    element.webkitRequestFullscreen();
  } else if (element.msRequestFullscreen) {
    // IE/Edge
    element.msRequestFullscreen();
  }
}

export default function EnterFullscreen({
  content,
  buttonText,
  next,
}: { prolificCode?: string; content?: React.ReactNode; buttonText?: string } & BaseComponentProps) {
  const contentWrap = (
    <div className='flex flex-col items-center'>
      {!!content && content}
      {!content && (
        <p className=''>Please click the Button below to enter Fullscreen mode.</p>
      )}
    </div>
  );

  return (
    <Text
      content={contentWrap}
      buttonText={buttonText ?? 'Enter Fullscreen Mode'}
      next={() => {
        enterFullscreen(document.documentElement);
        next({});
      }}
    />
  );
}
