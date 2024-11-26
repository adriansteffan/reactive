export function now() {
  return Math.round(performance.now());
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function shuffleArray(array: any[]) {
  for (let i = array.length - 1; i >= 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// Generic type for all data structures
export interface StudyEvent {
  index: number;
  type: string;
  name: string;
  data: any;
  start: number;
  end: number;
  duration: number;
}

export interface FileUpload {
  filename: string;
  content: string;
  encoding: 'base64' | 'utf8';
}
