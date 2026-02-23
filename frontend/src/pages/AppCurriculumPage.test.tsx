import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AppCurriculumPage } from '@/pages/AppCurriculumPage';
import type { CurriculumPackageV1 } from '@/types';

const navigateMock = vi.fn();
const getSampleCurriculumPackageMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock('@/api/curriculum', () => ({
  getSampleCurriculumPackage: (...args: unknown[]) => getSampleCurriculumPackageMock(...args),
}));

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({
    lang: 'en',
    t: (key: string) =>
      ({
        'app.curriculum.title': 'Curriculum',
        'app.curriculum.subtitle': 'Sample: AP French Units 1-3 (B1-B2)',
        'app.curriculum.unitLabel': 'Unit',
        'app.curriculum.moduleLabel': 'Module',
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
      situations: {
        interpretive_listening: [],
        interpersonal_speaking: [],
        presentational_speaking: [],
      },
      supportTargets: {
        comprehension: [],
        comprehensibility: [],
        vocabulary_usage: [],
        language_control: [],
        communication_strategies: [],
        cultural_awareness: [],
      },
      objectiveIds: ['obj.1'],
      sourceRefs: [{ docId: 'doc.ap.french', locator: 'mod.1.1' }],
    },
  ],
  objectives: [
    {
      id: 'obj.1',
      unitId: 'unit.1',
      moduleId: 'mod.1.1',
      mode: 'interpersonal_speaking',
      canDo: { en: 'Can discuss family members.' },
      contextTags: ['family_structures'],
      communicativeFunctions: ['ask_follow_up'],
      discourseMoves: ['turn_taking'],
      foundationDomains: ['comprehension'],
      register: 'informal',
      mastery: { rubricId: 'rub.interpersonal.v1', threshold: 2 },
      evidenceModel: { taskModel: 'ap.conversation' },
      templateRefs: ['tpl.sample.v1'],
      sourceRefs: [{ docId: 'doc.ap.french', locator: 'obj.1' }],
    },
  ],
  templates: {
    activityTemplateIds: ['tpl.sample.v1'],
  },
} as unknown as CurriculumPackageV1;

describe('AppCurriculumPage', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    getSampleCurriculumPackageMock.mockReset();
  });

  it('renders units/modules and navigates when a module is clicked', async () => {
    getSampleCurriculumPackageMock.mockResolvedValue(SAMPLE_CURRICULUM);

    render(<AppCurriculumPage />);

    await waitFor(() => {
      expect(screen.getByText('Families in Different Societies')).toBeInTheDocument();
    });

    expect(screen.getByText('Family members and relationships')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /show essential questions/i }));
    expect(screen.getByText('1. What counts as family?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /family members and relationships/i }));
    expect(navigateMock).toHaveBeenCalledWith('/app/curriculum/mod.1.1');
  });
});
