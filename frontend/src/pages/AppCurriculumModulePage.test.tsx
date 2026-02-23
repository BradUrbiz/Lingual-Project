import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AppCurriculumModulePage } from '@/pages/AppCurriculumModulePage';
import type { CurriculumPackageV1 } from '@/types';

const navigateMock = vi.fn();
const connectMock = vi.fn();
const disconnectMock = vi.fn();
const clearMessagesMock = vi.fn();
const getSampleCurriculumPackageMock = vi.fn();
const createChatSessionMock = vi.fn();
const saveMessageToChatMock = vi.fn();
let capturedSessionParams: unknown;

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useParams: () => ({ moduleId: 'mod.1.1' }),
  };
});

vi.mock('@/api/curriculum', () => ({
  getSampleCurriculumPackage: (...args: unknown[]) => getSampleCurriculumPackageMock(...args),
}));

vi.mock('@/api/chat', () => ({
  createChatSession: (...args: unknown[]) => createChatSessionMock(...args),
  saveMessageToChat: (...args: unknown[]) => saveMessageToChatMock(...args),
}));

vi.mock('@/hooks/useRealtimeChat', () => ({
  useRealtimeChat: (options: { sessionParams?: unknown }) => {
    capturedSessionParams = options?.sessionParams;
    return {
      isConnected: false,
      isListening: false,
      isSpeaking: false,
      messages: [],
      error: null,
      connect: connectMock,
      disconnect: disconnectMock,
      startListening: vi.fn(),
      stopListening: vi.fn(),
      clearMessages: clearMessagesMock,
    };
  },
}));

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({
    lang: 'en',
    t: (key: string) =>
      ({
        'app.curriculum.unitLabel': 'Unit',
        'app.curriculum.moduleLabel': 'Module',
        'app.curriculum.practice.start': 'Start voice practice',
        'app.curriculum.practice.openInChat': 'Open in Chat',
        'app.curriculum.practice.chooseSituation': 'Choose a speaking situation',
        'app.curriculum.practice.comingSoonListening': 'Interpretive listening (Coming soon)',
      })[key] || key,
  }),
}));

const SAMPLE_CURRICULUM = {
  schemaVersion: 'lingual.curriculum_package.v1',
  curriculum: {
    id: 'cur.fr.ap_french.fall2024.v1',
    title: { en: 'AP French' },
    learningLocale: 'fr-FR',
    levelBand: 'B1-B2',
    version: '1.0.0',
    createdAt: '2026-02-18T00:00:00Z',
    source: {
      type: 'import',
      name: 'AP French',
      effective: 'Fall 2024',
      docIds: ['doc.ap.french'],
    },
    license: { owner: 'College Board', notes: 'Sample' },
  },
  taxonomies: {
    contextTags: ['family_structures'],
    communicativeFunctions: ['ask_follow_up'],
    discourseMoves: ['turn_taking'],
    taskModels: ['ap.conversation'],
    foundationDomains: [
      'comprehension',
      'comprehensibility',
      'vocabulary_usage',
      'language_control',
      'communication_strategies',
      'cultural_awareness',
    ],
  },
  rubrics: [
    {
      id: 'rub.interpersonal.v1',
      title: { en: 'Interpersonal' },
      scale: { min: 0, max: 4 },
      dimensions: [{ id: 'interaction', title: { en: 'Interaction' }, description: { en: 'desc' } }],
    },
  ],
  units: [
    {
      id: 'unit.1',
      title: { en: 'Families in Different Societies' },
      ap: { unitNumber: 1, title: 'Families in Different Societies' },
      essentialQuestions: [{ en: 'What counts as family?' }],
      contextTags: ['family_structures'],
      moduleIds: ['mod.1.1'],
      sourceRefs: [{ docId: 'doc.ap.french', locator: 'Unit 1' }],
    },
  ],
  modules: [
    {
      id: 'mod.1.1',
      unitId: 'unit.1',
      title: { en: 'Family members and relationships' },
      moduleGoal: { en: 'Discuss family roles.' },
      capstone: {
        mode: 'interpersonal_speaking',
        taskModel: 'ap.conversation',
        situationId: 'sit.1.1.I01',
      },
      situations: {
        interpretive_listening: [
          {
            id: 'sit.1.1.L01',
            kind: 'interpretive_listening',
            seed: {
              setting: 'voice_message',
              roles: ['peer', 'peer'],
              contextTags: ['family_structures'],
              register: 'informal',
            },
            objectiveIds: ['obj.listen.1'],
          },
        ],
        interpersonal_speaking: [
          {
            id: 'sit.1.1.I01',
            kind: 'interpersonal_speaking',
            seed: {
              setting: 'first_meetup',
              roles: ['learner', 'new_friend'],
              contextTags: ['family_structures'],
              register: 'informal',
              constraints: { minTurns: 6, maxTurns: 10 },
            },
            objectiveIds: ['obj.speak.1'],
          },
        ],
        presentational_speaking: [
          {
            id: 'sit.1.1.P01',
            kind: 'presentational_speaking',
            seed: {
              setting: 'class_presentation',
              roles: ['presenter', 'audience'],
              contextTags: ['family_structures'],
              register: 'mixed',
              constraints: { timeLimitSec: 60 },
            },
            objectiveIds: ['obj.present.1'],
          },
        ],
      },
      supportTargets: {
        comprehension: [{ id: 'st.1', label: { en: 'Main idea' } }],
        comprehensibility: [{ id: 'st.2', label: { en: 'Question intonation' } }],
        vocabulary_usage: [{ id: 'st.3', label: { en: 'Family vocabulary' } }],
        language_control: [{ id: 'st.4', label: { en: 'Possessives' } }],
        communication_strategies: [{ id: 'st.5', label: { en: 'Follow-up questions' } }],
        cultural_awareness: [{ id: 'st.6', label: { en: 'tu/vous choices' } }],
      },
      objectiveIds: ['obj.listen.1', 'obj.speak.1', 'obj.present.1'],
      sourceRefs: [{ docId: 'doc.ap.french', locator: 'mod.1.1' }],
    },
  ],
  objectives: [
    {
      id: 'obj.listen.1',
      unitId: 'unit.1',
      moduleId: 'mod.1.1',
      mode: 'interpretive_listening',
      canDo: { en: 'Can identify key details in listening.' },
      contextTags: ['family_structures'],
      communicativeFunctions: ['ask_follow_up'],
      discourseMoves: ['turn_taking'],
      foundationDomains: ['comprehension'],
      register: 'informal',
      mastery: { rubricId: 'rub.interpersonal.v1', threshold: 2 },
      evidenceModel: { taskModel: 'ap.conversation' },
      templateRefs: ['tpl.sample.v1'],
      sourceRefs: [{ docId: 'doc.ap.french', locator: 'obj.listen.1' }],
    },
    {
      id: 'obj.speak.1',
      unitId: 'unit.1',
      moduleId: 'mod.1.1',
      mode: 'interpersonal_speaking',
      canDo: { en: 'Can ask and answer family questions.' },
      contextTags: ['family_structures'],
      communicativeFunctions: ['ask_follow_up'],
      discourseMoves: ['turn_taking'],
      foundationDomains: ['communication_strategies'],
      register: 'informal',
      mastery: { rubricId: 'rub.interpersonal.v1', threshold: 2 },
      evidenceModel: { taskModel: 'ap.conversation' },
      templateRefs: ['tpl.sample.v1'],
      sourceRefs: [{ docId: 'doc.ap.french', locator: 'obj.speak.1' }],
    },
    {
      id: 'obj.present.1',
      unitId: 'unit.1',
      moduleId: 'mod.1.1',
      mode: 'presentational_speaking',
      canDo: { en: 'Can deliver a short family presentation.' },
      contextTags: ['family_structures'],
      communicativeFunctions: ['ask_follow_up'],
      discourseMoves: ['turn_taking'],
      foundationDomains: ['language_control'],
      register: 'mixed',
      mastery: { rubricId: 'rub.interpersonal.v1', threshold: 2 },
      evidenceModel: { taskModel: 'ap.conversation' },
      templateRefs: ['tpl.sample.v1'],
      sourceRefs: [{ docId: 'doc.ap.french', locator: 'obj.present.1' }],
    },
  ],
  templates: {
    activityTemplateIds: ['tpl.sample.v1'],
  },
} as unknown as CurriculumPackageV1;

describe('AppCurriculumModulePage', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    connectMock.mockReset();
    connectMock.mockResolvedValue(undefined);
    disconnectMock.mockReset();
    clearMessagesMock.mockReset();
    getSampleCurriculumPackageMock.mockReset();
    createChatSessionMock.mockReset();
    saveMessageToChatMock.mockReset();
    capturedSessionParams = undefined;
  });

  it('creates a chat and starts practice with curriculum session params', async () => {
    getSampleCurriculumPackageMock.mockResolvedValue(SAMPLE_CURRICULUM);
    createChatSessionMock.mockResolvedValue({
      chatId: 'chat-123',
      title: 'CUR mod.1.1 - Family members and relationships',
    });

    render(<AppCurriculumModulePage />);

    await waitFor(() => {
      expect(screen.getByText('Family members and relationships')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /start voice practice/i }));

    await waitFor(() => {
      expect(createChatSessionMock).toHaveBeenCalledTimes(1);
    });
    expect(createChatSessionMock).toHaveBeenCalledWith('CUR mod.1.1 - Family members and relationships');

    await waitFor(() => {
      expect(connectMock).toHaveBeenCalledTimes(1);
    });
    expect(clearMessagesMock).toHaveBeenCalled();
    expect(disconnectMock).toHaveBeenCalled();

    expect(capturedSessionParams).toEqual({
      uiLanguage: 'en',
      practice: {
        type: 'curriculum_module',
        curriculumId: 'cur.fr.ap_french.fall2024.v1',
        moduleId: 'mod.1.1',
        situationId: 'sit.1.1.I01',
      },
    });
  });
});
