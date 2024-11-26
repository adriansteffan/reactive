/* eslint-disable @typescript-eslint/no-explicit-any */
import { FileUpload, StudyEvent } from './common';



export function arrayToCSV(array: any[]): string {
  if (array.length === 0) return '';
  // Get all possible headers from all objects
  const headers = new Set<string>();
  array.forEach((obj) => {
    Object.keys(obj).forEach((key) => headers.add(key));
  });

  const headerRow = Array.from(headers).join(',');
  const rows = array.map((obj) =>
    Array.from(headers)
      .map((header) => {
        const value = obj[header];
        // Handle values that might need quotes
        if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value ?? '';
      })
      .join(','),
  );

  return [headerRow, ...rows].join('\n');
}

function processSurvey(
  prefix: string,
  surveyData: { type: string; name: string; value: any }[],
): { answers: object; audios: object[] } {
  const answers: { [key: string]: any } = {};
  const audios = [];
  for (const question of surveyData) {
    if (question.type == 'voicerecorder') {
      audios.push({ name: `${prefix}_${question.name}`, url: question.value.url });
      continue;
    }
    answers[question.name] = question.value;
  }
  return {
    answers,
    audios,
  };
}

// This function is highly dependent on our study structure, maybe move this to the backend and have the frontend be fully agnostic
export function convertData(studyData: StudyEvent[]) {
  const globalData: any[] = [];
  const blockData: any[] = [];
  const gameData: any[] = [];
  const guessData: any[] = [];
  let audioData: any[] = [];

  // used to differentiate between global surveys and the surveys that belong to a preceeding block
  let lastTrialWasMasterMindle = false;
  for (let i = 0; i <= studyData.length; i++) {
    const trial = studyData[i];
    if (!trial) {
      continue;
    }

    const baseEventData = {
      index: trial.index,
      type: trial.type,
      name: trial.name,
      duration: trial.duration,
      start: trial.start,
      end: trial.end,
    };

    switch (trial.type) {
      case 'MasterMindleWrapper': {
        lastTrialWasMasterMindle = true;
        const blockSurvey = studyData[i + 1];
        const { answers, audios } = processSurvey(`${trial.name}`, blockSurvey.data);
        audioData = [...audioData, ...audios];
        const { data: games, ...trialMetaData } = trial.data;

        blockData.push({ ...baseEventData, ...trialMetaData, ...answers });

        // alternating game and survey
        let gameMetaData: { solution?: string[] | string } = {};
        for (const subTrial of games) {
          if (subTrial.type == 'game') {
            const gameIndex = subTrial.index / 2;
            let guesses = [];
            ({ guesses, ...gameMetaData } = subTrial.data);

            if (gameMetaData.solution && typeof gameMetaData.solution != 'string') {
              gameMetaData.solution = gameMetaData.solution.join('_');
            }

            for (const guess of guesses) {
              guessData.push({
                index: guess.index,
                gameIndex: gameIndex,
                blockIndex: trialMetaData.blockIndex,
                blockFeedbacktype: trialMetaData.feedbacktype,
                start: guess.start,
                end: guess.end,
                duration: guess.duration,
                isCorrect: guess.isCorrect,
                colors: guess.colors.join('_'),
                results: guess.results.map((res: { status: any }) => res.status).join('_'),
              });
            }
          } else if (subTrial.type == 'survey') {
            const gameIndex = (subTrial.index - 1) / 2;
            const { answers, audios } = processSurvey(`${trial.name}_${gameIndex}`, subTrial.data);
            audioData = [...audioData, ...audios];
            gameData.push({
              ...{
                index: gameIndex,
                blockIndex: trialMetaData.blockIndex,
                blockFeedbacktype: trialMetaData.feedbacktype,
                type: subTrial.type,
                name: subTrial.name,
                duration: subTrial.duration,
                start: subTrial.start,
                end: subTrial.end,
              },
              ...gameMetaData,
              ...answers,
            });
          }
        }

        break;
      }
      case 'Quest': {
        if (lastTrialWasMasterMindle) {
          break; // already read in prev iteration by the mastermindle looking ahead 1
        }

        const { answers, audios } = processSurvey(`${trial.name}`, trial.data);
        audioData = [...audioData, ...audios];

        globalData.push({ ...baseEventData, ...answers });
        break;
      }
    }

    if (trial.type != 'MasterMindleWrapper') {
      lastTrialWasMasterMindle = false;
    }
  }

  return {
    globalCsv: arrayToCSV(globalData),
    blockCsv: arrayToCSV(blockData),
    gameCsv: arrayToCSV(gameData),
    guessCsv: arrayToCSV(guessData),
    audios: audioData,
  };
}

export default convertData;

async function blobUrlToBase64(blobUrl: string): Promise<string> {
  const response = await fetch(blobUrl);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        const base64String = reader.result.split(',')[1];
        resolve(base64String);
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}


export async function generateFiles(sessionId: string, data: any) {
  const files: FileUpload[] = [];
  const convertedData = convertData(data);

  files.push(
    { filename: `${sessionId}_global.csv`, content: convertedData.globalCsv, encoding: 'utf8' },
    { filename: `${sessionId}_block.csv`, content: convertedData.blockCsv, encoding: 'utf8' },
    { filename: `${sessionId}_game.csv`, content: convertedData.gameCsv, encoding: 'utf8' },
    { filename: `${sessionId}_guess.csv`, content: convertedData.guessCsv, encoding: 'utf8' },
  );

  // Process audio files
  for (const audiodata of convertedData.audios) {
    if (audiodata.url.startsWith('blob:')) {
      try {
        const base64Content = await blobUrlToBase64(audiodata.url);
        files.push({
          filename: `${audiodata.name}.wav`,
          content: base64Content,
          encoding: 'base64',
        });
      } catch (error) {
        console.error(`Error processing audio recording for ${audiodata.name}:`, error);
      }
    }
  }
}
