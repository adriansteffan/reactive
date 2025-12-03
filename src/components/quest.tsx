import { useCallback, createElement, ComponentType } from 'react';
import { defaultCss, Model, Question, Serializer } from 'survey-core';
import { ReactQuestionFactory, Survey, SurveyQuestionElementBase } from 'survey-react-ui';
import { ContrastLight } from 'survey-core/themes';
import 'survey-core/survey-core.min.css';

type ComponentsMap = {
  [key: string]: ComponentType<any>;
};

const registerCustomQuestion = (name: string, component: ComponentType<any>) => {
  class CustomQuestionModel extends Question {
    getType() {
      return name;
    }
  }

  Serializer.addClass(
    name,
    [],
    function () {
      return new CustomQuestionModel('');
    },
    'question',
  );

  class CustomQuestionWrapper extends SurveyQuestionElementBase {
    constructor(props: any) {
      super(props);
      this.state = { value: this.questionBase.value };
    }

    get question() {
      return this.questionBase;
    }

    renderElement() {
      const Component = component;
      return (
        <Component
          setValue={(val: any) => {
            this.question.value = val;
          }}
        />
      );
    }
  }

  ReactQuestionFactory.Instance.registerQuestion(name, (props) => {
    return createElement(CustomQuestionWrapper, props);
  });
};

// The main Quest component
function Quest({
  next,
  surveyJson,
  customQuestions = {},
}: {
  next: (data: object) => void;
  surveyJson: object;
  customQuestions?: ComponentsMap;
}) {
  Object.keys(customQuestions).forEach((name) => {
    registerCustomQuestion(name, customQuestions[name]);
  });

  const survey = new Model({
    ...surveyJson,
    css: { ...defaultCss, root: 'sd-root-modern custom-root' },
  });
  survey.applyTheme(ContrastLight);

  const saveResults = useCallback(
    (sender: any) => {
      next({ ...sender.data });
    },
    [next],
  );

  survey.onComplete.add(saveResults);

  return (
    <div className='max-w-4xl mx-auto px-4'>
      <div className='absolute inset-0 -z-10 h-full w-full bg-white bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px]' />
      <Survey model={survey} />
    </div>
  );
}

export default Quest;
