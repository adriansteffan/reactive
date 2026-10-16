// Runs a shell command without blocking, so that participants simulated at the same time do not wait for each other
function run(command: string): Promise<string> {
  const { exec } = process.getBuiltinModule('child_process');
  return new Promise((resolve, reject) => {
    exec(command, { encoding: 'utf8' }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
  });
}

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
    const path = process.getBuiltinModule('path');
    const fs = process.getBuiltinModule('fs');
    const os = process.getBuiltinModule('os');

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reactive-tts-'));
    const wavPath = path.join(dir, 'tts.wav');
    const webmPath = path.join(dir, 'tts.webm');

    const escaped = text.replace(/"/g, '\\"');
    const platform = process.platform;

    if (platform === 'darwin') {
      let voice = '';
      try {
        const voices = await run('say -v "?"');
        if (voices.includes('Ava')) voice = '-v "Ava (Premium)"';
      } catch { /* use default */ }
      await run(`say ${voice} -o "${wavPath}" --data-format=LEI16@22050 "${escaped}"`);
    } else if (platform === 'win32') {
      const ps = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SetOutputToWaveFile('${wavPath.replace(/'/g, "''")}'); $s.Speak('${escaped.replace(/'/g, "''")}'); $s.Dispose()`;
      await run(`powershell -Command "${ps.replace(/"/g, '\\"')}"`);
    } else {
      try {
        await run(`espeak-ng -w "${wavPath}" "${escaped}"`);
      } catch {
        await run(`espeak -w "${wavPath}" "${escaped}"`);
      }
    }

    await run(`ffmpeg -i "${wavPath}" -c:a libopus -b:a 24k "${webmPath}" -y`);

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
    const fs = process.getBuiltinModule('fs');
    const path = process.getBuiltinModule('path');
    const os = process.getBuiltinModule('os');

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reactive-probe-'));
    const tmp = path.join(dir, 'audio.webm');
    fs.writeFileSync(tmp, Buffer.from(base64Audio, 'base64'));
    const out = (await run(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${tmp}"`)).trim();
    fs.rmSync(dir, { recursive: true, force: true });
    return Math.round(parseFloat(out) * 1000);
  } catch {
    return null;
  }
}
