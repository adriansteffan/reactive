import { BaseComponentProps } from '../core/component';
import { useEffect, useRef, useState } from 'react';
import { defineComponent } from '../core/component';
import { useTheme, t } from '../runner/theme';

export interface DeviceInfo {
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

// Edge's user agent names Chrome too, and Android's and iOS's name Linux and Mac OS X, so they come first
const browsers: [string, RegExp][] = [
  ['Edge', /Edg(?:e|A|iOS)?\/(\d+\.\d+)/],
  ['Chrome', /(?:Chrome|CriOS)\/(\d+\.\d+)/],
  ['Firefox', /(?:Firefox|FxiOS)\/(\d+\.\d+)/],
  ['Safari', /Version\/(\d+\.\d+).*Safari/],
];
const systems: [string, RegExp][] = [
  ['Android', /Android/],
  ['iOS', /iPhone|iPad|iPod/],
  ['Windows', /Windows/],
  ['MacOS', /Macintosh|Mac OS X/],
  ['Linux', /Linux/],
];

/** The browser, its version and the operating system that a user agent names. */
export function describeUserAgent(userAgent: string) {
  let browser = 'Unknown';
  let browserVersion = 'Unknown';
  for (const [name, pattern] of browsers) {
    const match = userAgent.match(pattern);
    if (match) {
      browser = name;
      browserVersion = match[1];
      break;
    }
  }
  const operatingSystem = systems.find(([, pattern]) => pattern.test(userAgent))?.[0] ?? 'Unknown';
  return { browser, browserVersion, operatingSystem };
}

function CheckDevice({
  acceptDevice,
  errorContent = <div>Your device doesn't meet the requirements for this experiment.</div>,
  next,
}: {
  /** Whether the device fits the study. Without it, every device does. */
  /** Whether the participant's device fits the experiment; one that does not ends it on this screen. */
  acceptDevice?: (deviceInfo: DeviceInfo) => boolean;
  /** Shown when the device does not fit. */
  errorContent?: React.ReactNode;
} & BaseComponentProps<DeviceInfo>) {
  const [showContent, setShowContent] = useState<boolean>(false);

  const hasNavigatedRef = useRef(false);

  useEffect(() => {
    if (hasNavigatedRef.current) {
      return;
    }

    const gatherDeviceInfo = async () => {
      const windowWidth = window.innerWidth;
      const windowHeight = window.innerHeight;

      const screenWidth = window.screen.width;
      const screenHeight = window.screen.height;

      const userAgent = navigator.userAgent;
      const { browser, browserVersion, operatingSystem } = describeUserAgent(userAgent);

      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        userAgent,
      );

      const hasWebAudio = !!(
        window.AudioContext ||
        (window as any).webkitAudioContext ||
        (window as any).mozAudioContext ||
        (window as any).oAudioContext ||
        (window as any).msAudioContext
      );

      const hasFullscreen = !!(document.exitFullscreen || (document as any).webkitExitFullscreen);

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

      const checkResult = acceptDevice ? acceptDevice(deviceInfo) : true;

      if (checkResult && !hasNavigatedRef.current) {
        hasNavigatedRef.current = true;
        next(deviceInfo);
      } else {
        setShowContent(true);
      }
    };

    gatherDeviceInfo();
  }, [acceptDevice, next]);

  const th = t(useTheme());

  return showContent ? (
    <div className={`min-h-screen ${th.containerBg}`}>
    <div className='max-w-prose mx-auto mt-20 mb-20 px-4'>
      <article className={th.article}>
        {errorContent}
      </article>
    </div>
    </div>
  ) : null;
}

export default defineComponent({
  name: 'CheckDevice',
  component: CheckDevice,
  session: true,
  simulate: () => {
    const deviceInfo = {
      windowWidth: 1920, windowHeight: 1080, screenWidth: 1920, screenHeight: 1080,
      browser: 'Simulated', browserVersion: '1.0', isMobile: false,
      operatingSystem: 'Simulated', hasWebAudio: true, hasFullscreen: true,
      hasWebcam: true, hasMicrophone: true,
    };
    return { responseData: deviceInfo };
  },
});
