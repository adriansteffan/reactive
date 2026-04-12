import { getNodeRequire } from './nodecompat';

/**
 * Generates a WebM audio file from text using the platform's native TTS.
 * Requires `ffmpeg` to be installed for WAV->WebM conversion.
 *
 * - macOS: `say` (prefers Ava voice if available)
 * - Linux: `espeak-ng` or `espeak`
 * - Windows: PowerShell `System.Speech`
 *
 * Returns base64-encoded WebM audio, or null if TTS/ffmpeg is unavailable.
 */
export async function textToWebmBase64(text: string): Promise<string | null> {
  try {
    const req = await getNodeRequire();
    const childProcess: typeof import('child_process') = req('child_process');
    const path: typeof import('path') = req('path');
    const fs: typeof import('fs') = req('fs');
    const os: typeof import('os') = req('os');

    const { execSync } = childProcess;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reactive-tts-'));
    const wavPath = path.join(dir, 'tts.wav');
    const webmPath = path.join(dir, 'tts.webm');

    const escaped = text.replace(/"/g, '\\"');
    const platform = process.platform;

    if (platform === 'darwin') {
      let voice = '';
      try {
        const voices = execSync('say -v "?"', { encoding: 'utf8' });
        if (voices.includes('Ava')) voice = '-v "Ava (Premium)"';
      } catch { /* use default */ }
      execSync(`say ${voice} -o "${wavPath}" --data-format=LEI16@22050 "${escaped}"`, { stdio: 'ignore' });
    } else if (platform === 'win32') {
      const ps = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SetOutputToWaveFile('${wavPath.replace(/'/g, "''")}'); $s.Speak('${escaped.replace(/'/g, "''")}'); $s.Dispose()`;
      execSync(`powershell -Command "${ps.replace(/"/g, '\\"')}"`, { stdio: 'ignore' });
    } else {
      try {
        execSync(`espeak-ng -w "${wavPath}" "${escaped}"`, { stdio: 'ignore' });
      } catch {
        execSync(`espeak -w "${wavPath}" "${escaped}"`, { stdio: 'ignore' });
      }
    }

    execSync(`ffmpeg -i "${wavPath}" -c:a libopus -b:a 24k "${webmPath}" -y`, { stdio: 'ignore' });

    const webmData = fs.readFileSync(webmPath);
    const base64 = webmData.toString('base64');

    try { fs.unlinkSync(wavPath); } catch { /* ignore */ }
    try { fs.unlinkSync(webmPath); } catch { /* ignore */ }
    try { fs.rmdirSync(dir); } catch { /* ignore */ }

    return base64;
  } catch {
    return null;
  }
}

/**
 * Returns the duration of a base64-encoded audio file in milliseconds using ffprobe.
 * Returns null if ffprobe is unavailable or the audio can't be probed.
 */
export async function probeAudioDurationMs(base64Audio: string): Promise<number | null> {
  try {
    const req = await getNodeRequire();
    const { execSync } = req('child_process') as typeof import('child_process');
    const fs = req('fs') as typeof import('fs');
    const path = req('path') as typeof import('path');
    const os = req('os') as typeof import('os');

    const tmp = path.join(os.tmpdir(), `reactive-probe-${Date.now()}.webm`);
    fs.writeFileSync(tmp, Buffer.from(base64Audio, 'base64'));
    const out = execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${tmp}"`, { encoding: 'utf8' }).trim();
    fs.unlinkSync(tmp);
    return Math.round(parseFloat(out) * 1000);
  } catch {
    return null;
  }
}
