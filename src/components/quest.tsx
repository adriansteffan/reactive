import { useCallback, createElement, ComponentType } from 'react';
import { defaultCss, Model, Question, Serializer } from 'survey-core';
import { ReactQuestionFactory, Survey, SurveyQuestionElementBase } from 'survey-react-ui';
import { ContrastLight, ContrastDark } from 'survey-core/themes';
import 'survey-core/survey-core.min.css';
import { registerSimulation } from '../utils/simulation';
import { registerFlattener } from '../utils/upload';
import { uniform } from '../utils/distributions';
import { useTheme, t } from '../utils/theme';

registerFlattener('Quest', 'session');

registerSimulation('Quest', (trialProps, _experimentState, simulators, participant) => {
  const responseData: Record<string, any> = {};
  let totalDuration = 0;
  const pages = trialProps.surveyJson?.pages || [{ elements: trialProps.surveyJson?.elements || [] }];
  for (const page of pages) {
    for (const el of page.elements || []) {
      if (!el.name) continue;
      const result = simulators.answerQuestion(el, participant);
      participant = result.participantState;
      responseData[el.name] = result.value;
      totalDuration += result.duration ?? 0;
    }
  }
  return { responseData, participantState: participant, duration: totalDuration };
}, {
  answerQuestion: (question: any, participant: any) => {
    let value;
    switch (question.type) {
      case 'rating': {
        const min = question.rateMin ?? 1, max = question.rateMax ?? 5;
        value = min + Math.floor(uniform(0, max - min + 1));
        break;
      }
      case 'boolean': value = uniform(0, 1) > 0.5; break;
      case 'text': case 'comment': value = 'simulated_response'; break;
      case 'radiogroup': case 'dropdown': {
        const c = question.choices?.[Math.floor(uniform(0, question.choices?.length || 0))];
        value = c !== undefined ? (typeof c === 'object' ? c.value : c) : null;
        break;
      }
      case 'checkbox': {
        if (question.choices?.length) {
          const n = 1 + Math.floor(uniform(0, question.choices.length));
          value = [...question.choices]
            .sort(() => uniform(0, 1) - 0.5).slice(0, n)
            .map((c: any) => typeof c === 'object' ? c.value : c);
        }
        break;
      }
      case 'matrix': {
        if (question.rows?.length && question.columns?.length) {
          value = Object.fromEntries(
            question.rows.map((r: any) => {
              const col = question.columns[Math.floor(uniform(0, question.columns.length))];
              return [typeof r === 'object' ? r.value : r, typeof col === 'object' ? col.value : col];
            }),
          );
        }
        break;
      }
      default: value = null;
    }
    return { value, participantState: participant, duration: uniform(1000, 5000) };
  },
});

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
  theme,
  containerClass,
}: {
  next: (data: object) => void;
  surveyJson: object;
  customQuestions?: ComponentsMap;
  theme?: any;
  containerClass?: string;
}) {
  const contextTheme = useTheme();
  const th = t(contextTheme);

  Object.keys(customQuestions).forEach((name) => {
    registerCustomQuestion(name, customQuestions[name]);
  });

  const survey = new Model({
    ...surveyJson,
    css: { ...defaultCss, root: 'sd-root-modern custom-root' },
  });
  survey.applyTheme(theme ?? (contextTheme === 'dark' ? ContrastDark : ContrastLight));

  const saveResults = useCallback(
    (sender: any) => {
      next({ ...sender.data });
    },
    [next],
  );

  survey.onComplete.add(saveResults);

  const useCustomBg = !!containerClass || contextTheme === 'dark';

  return (
    <div className={`min-h-screen ${containerClass ?? th.containerBg}`}>
      {!useCustomBg && <div className='absolute inset-0 -z-10 h-full w-full bg-white bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px]' />}
      <div className={`max-w-4xl mx-auto px-4${useCustomBg ? ' quest-custom-bg' : ''}`}>
        <Survey model={survey} />
      </div>
    </div>
  );
}

export default Quest;
