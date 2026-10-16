import { useCallback, createElement, ComponentType } from 'react';
import { defaultCss, Model, Question, Serializer } from 'survey-core';
import { ReactQuestionFactory, Survey, SurveyQuestionElementBase } from 'survey-react-ui';
import { ContrastLight, ContrastDark } from 'survey-core/themes';
import 'survey-core/survey-core.min.css';
import { defineComponent } from '../core/component';
import { uniform } from '../utils/distributions';
import { useTheme, t } from '../runner/theme';
import { Recorder } from './recorder';

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

// The voicerecorder question type, which records an answer with the shared recorder
function VoiceRecorderQuestion({ setValue }: { setValue: (data: object | null) => void }) {
  return <Recorder handleSaveVoiceData={(data) => setValue(data)} handleDiscardVoiceData={() => setValue(null)} />;
}

function Quest({
  next,
  surveyJson,
  customQuestions,
  surveyTheme,
  containerClass,
}: {
  next: (data?: Record<string, any>) => void;
  surveyJson: Record<string, any>;
  /** Custom question types, by the name the survey's elements use as their type. */
  customQuestions?: ComponentsMap;
  /** A SurveyJS theme; by default one that matches the experiment's theme. */
  surveyTheme?: any;
  containerClass?: string;
}) {
  const contextTheme = useTheme();
  const th = t(contextTheme);

  const questions: ComponentsMap = {
    voicerecorder: VoiceRecorderQuestion,
    ...customQuestions,
  };
  Object.keys(questions).forEach((name) => {
    registerCustomQuestion(name, questions[name]);
  });

  const survey = new Model({
    ...surveyJson,
    css: { ...defaultCss, root: 'sd-root-modern custom-root' },
  });
  survey.applyTheme(surveyTheme ?? (contextTheme.startsWith('dark') ? ContrastDark : ContrastLight));

  const saveResults = useCallback(
    (sender: any) => {
      next({ ...sender.data });
    },
    [next],
  );

  survey.onComplete.add(saveResults);

  const useCustomBg = !!containerClass || contextTheme.startsWith('dark');

  return (
    <div className={`min-h-screen ${containerClass ?? th.containerBg}`}>
      {!useCustomBg && <div className='absolute inset-0 -z-10 h-full w-full bg-white bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px]' />}
      <div className={`max-w-4xl mx-auto px-4${useCustomBg ? ' quest-custom-bg' : ''}`}>
        <Survey model={survey} />
      </div>
    </div>
  );
}

export default defineComponent({
  name: 'Quest',
  component: Quest,
  csv: 'session',
  simulate: ({ props, simulators, participant }) => {
    const responseData: Record<string, any> = {};
    let totalDuration = 0;
    const pages = props.surveyJson?.pages || [{ elements: props.surveyJson?.elements || [] }];
    for (const page of pages) {
      for (const el of page.elements || []) {
        if (!el.name) continue;
        const result = simulators.answerQuestion({ props, participant, question: el });
        participant = result.participantState ?? participant;
        responseData[el.name] = result.value;
        totalDuration += result.durationMs ?? 0;
      }
    }
    return { responseData, participantState: participant, durationMs: totalDuration };
  },
  defaultSimulators: {
    answerQuestion: ({ question }) => {
      let value: any;
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
      return { value, durationMs: uniform(1000, 5000) };
    },
  },
});
