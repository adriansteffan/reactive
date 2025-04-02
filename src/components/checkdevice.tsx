import { BaseComponentProps } from '../mod';
import { useEffect, useState } from 'react';

interface DeviceInfo {
  windowWidth: number;
  windowHeight: number;
  screenWidth: number;
  screenHeight: number;
  browser: string;
  browserVersion: string;
  isMobile: boolean;
  operatingSystem: string;
  hasWebAudio: boolean;
  hasFullscreen: boolean;
  hasWebcam: boolean;
  hasMicrophone: boolean;
}

function CheckDevice({
  check,
  content = <div>Your device doesn't meet the requirements for this experiment.</div>,
  data,
  store,
  updateStore,
  next,
}: {
  check: (deviceInfo: DeviceInfo, data: any, store: any) => boolean;
  content?: React.ReactNode;
} & BaseComponentProps) {
  const [showContent, setShowContent] = useState<boolean>(false);

  useEffect(() => {
    const gatherDeviceInfo = async () => {
      const windowWidth = window.innerWidth;
      const windowHeight = window.innerHeight;

      const screenWidth = window.screen.width;
      const screenHeight = window.screen.height;

      const userAgent = navigator.userAgent;
      let browser = 'Unknown';
      let browserVersion = 'Unknown';

      if (userAgent.indexOf('Chrome') > -1) {
        browser = 'Chrome';
        const match = userAgent.match(/Chrome\/(\d+\.\d+)/);
        browserVersion = match ? match[1] : 'Unknown';
      } else if (userAgent.indexOf('Firefox') > -1) {
        browser = 'Firefox';
        const match = userAgent.match(/Firefox\/(\d+\.\d+)/);
        browserVersion = match ? match[1] : 'Unknown';
      } else if (userAgent.indexOf('Safari') > -1) {
        browser = 'Safari';
        const match = userAgent.match(/Version\/(\d+\.\d+)/);
        browserVersion = match ? match[1] : 'Unknown';
      } else if (userAgent.indexOf('Edge') > -1) {
        browser = 'Edge';
        const match = userAgent.match(/Edge\/(\d+\.\d+)/);
        browserVersion = match ? match[1] : 'Unknown';
      } else if (userAgent.indexOf('MSIE') > -1 || userAgent.indexOf('Trident/') > -1) {
        browser = 'Internet Explorer';
        const match = userAgent.match(/(?:MSIE |rv:)(\d+\.\d+)/);
        browserVersion = match ? match[1] : 'Unknown';
      }

      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        userAgent,
      );

      let operatingSystem = 'Unknown';
      if (/Windows/.test(userAgent)) {
        operatingSystem = 'Windows';
      } else if (/Macintosh|Mac OS X/.test(userAgent)) {
        operatingSystem = 'MacOS';
      } else if (/Linux/.test(userAgent)) {
        operatingSystem = 'Linux';
      } else if (/Android/.test(userAgent)) {
        operatingSystem = 'Android';
      } else if (/iOS|iPhone|iPad|iPod/.test(userAgent)) {
        operatingSystem = 'iOS';
      }

      const hasWebAudio = !!(
        window.AudioContext ||
        (window as any).webkitAudioContext ||
        (window as any).mozAudioContext ||
        (window as any).oAudioContext ||
        (window as any).msAudioContext
      );

      const hasFullscreen = !!(
        document.exitFullscreen ||
        (document as any).webkitExitFullscreen ||
        (document as any).mozCancelFullScreen ||
        (document as any).msExitFullscreen ||
        document.fullscreenEnabled ||
        (document as any).webkitFullscreenEnabled ||
        (document as any).mozFullScreenEnabled ||
        (document as any).msFullscreenEnabled
      );

      let hasWebcam = false;
      let hasMicrophone = false;

      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        hasWebcam = devices.some((device) => device.kind === 'videoinput');
        hasMicrophone = devices.some((device) => device.kind === 'audioinput');
      } catch (error) {
        console.error('Error checking media devices:', error);
      }

      const deviceInfo: DeviceInfo = {
        windowWidth,
        windowHeight,
        screenWidth,
        screenHeight,
        browser,
        browserVersion,
        isMobile,
        operatingSystem,
        hasWebAudio,
        hasFullscreen,
        hasWebcam,
        hasMicrophone,
      };

      updateStore({ _reactiveDeviceInfo: deviceInfo });

      const checkResult = check ? check(deviceInfo, data, store) : true;

      if (checkResult) {
        next({});
      } else {
        setShowContent(true);
      }
    };

    gatherDeviceInfo();
  }, [check, data, updateStore, next]);

  return showContent ? (
    <div className='max-w-prose mx-auto mt-20 mb-20 px-4'>
      <article className='prose prose-2xl prose-slate text-xl prose-a:text-blue-600 prose-a:underline prose-h1:text-4xl prose-h1:mb-10 prose-h1:font-bold prose-p:mb-4 prose-strong:font-bold text-black leading-relaxed'>
        {content}
      </article>
    </div>
  ) : null;
}

export default CheckDevice;
