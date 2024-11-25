import { useCallback, createElement } from 'react';
import { defaultV2Css, Model, Question, Serializer } from 'survey-core';
import { ReactQuestionFactory, Survey, SurveyQuestionElementBase } from 'survey-react-ui';
import { ContrastLight } from 'survey-core/themes';
import VoicerecorderQuestionComponent from './voicerecorder';
import 'survey-core/defaultV2.min.css';

const CUSTOM_TYPE = 'voicerecorder';

export class VoiceRecorderModel extends Question {
  getType() {
    return CUSTOM_TYPE;
  }
}

Serializer.addClass(
  CUSTOM_TYPE,
  [],
  function () {
    return new VoiceRecorderModel('');
  },
  'question',
);

class VoiceRecorderQuestion extends SurveyQuestionElementBase {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(props: any) {
    super(props);
    this.state = { value: this.question.value };
  }
  get question() {
    return this.questionBase;
  }

  get style() {
    return this.question.getPropertyValue('readOnly') || this.question.isDesignMode
      ? { pointerEvents: 'none' }
      : undefined;
  }

  renderElement() {
    return (
      <VoicerecorderQuestionComponent
        setValue={(val) => {
          this.question.value = val;
        }}
      />
    );
  }
}

ReactQuestionFactory.Instance.registerQuestion('voicerecorder', (props) => {
  return createElement(VoiceRecorderQuestion, props);
});

const myCustomTheme = {
  // Keep the base classes from the default theme
  ...defaultV2Css,
  root: 'sd-root-modern custom-root',
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
