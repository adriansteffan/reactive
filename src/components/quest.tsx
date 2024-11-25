import 'survey-core/defaultV2.min.css';
import { defaultV2Css, Model } from 'survey-core';
import { ReactQuestionFactory, Survey } from 'survey-react-ui';
import { useCallback } from 'react';

import { ContrastLight } from 'survey-core/themes';

import VoiceRecorderQuestion from './voicerecorder';

import { createElement } from 'react';
ReactQuestionFactory.Instance.registerQuestion('voicerecorder', (props) => {
  return createElement(VoiceRecorderQuestion, props);
});

const myCustomTheme = {
  // Keep the base classes from the default theme
  ...defaultV2Css,
  root: 'sd-root-modern custom-root',
  matrix: {
    root: 'sd-matrix',
    cell: 'sd-matrix__cell',
    headerCell: 'sd-matrix__cell--header',
    itemValue: 'sd-matrix__cell-text',
    row: 'sd-matrix__row',
  },
};

function Quest({ next, surveyJson }: { next: (data: object) => void; surveyJson: object }) {
  const survey = new Model({ ...surveyJson, css: myCustomTheme });
  survey.applyTheme(ContrastLight);
  
  const saveResults = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sender: any) => {
      const resultData = [];
      for (const key in sender.data) {
        const question = sender.getQuestionByName(key);
        if (question) {
          const item = {
            name: key,
            type: question.jsonObj.type,
            value: question.value,
            //title: question.displayValue,
            //displayValue: question.displayValue,
          };
          resultData.push(item);
        }
      }

      next(resultData);
    },
    [next],
  );

  survey.onComplete.add(saveResults);
  return (
    <div className='max-w-4xl mx-auto'>
      <div className='absolute inset-0 -z-10 h-full w-full bg-white bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px]'></div>
      <Survey model={survey} />
    </div>
  );
}

export default Quest;
