import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TeacherAssignmentBuilderPage } from '@/pages/TeacherAssignmentBuilderPage';
import type { StudentAssignmentSummary, TeacherClassSummary } from '@/types';
import type { CanvasCourseContentItem } from '@/types/canvas';

const navigateMock = vi.fn();
const getTeacherClassesMock = vi.fn();
const getTeacherAssignmentsMock = vi.fn();
const createAssignmentMock = vi.fn();
const generateAssignmentDraftMock = vi.fn();
const getCanvasContentForClassMock = vi.fn();
const generateCanvasPracticeMock = vi.fn();
const createCanvasPracticeMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useParams: () => ({ classId: 'class-1' }),
  };
});

vi.mock('@/api/teacher', () => ({
  getTeacherClasses: (...args: unknown[]) => getTeacherClassesMock(...args),
}));

vi.mock('@/api/assignments', () => ({
  getTeacherAssignments: (...args: unknown[]) => getTeacherAssignmentsMock(...args),
  createAssignment: (...args: unknown[]) => createAssignmentMock(...args),
  generateAssignmentDraft: (...args: unknown[]) => generateAssignmentDraftMock(...args),
}));

vi.mock('@/api/canvas', () => ({
  getCanvasContentForClass: (...args: unknown[]) => getCanvasContentForClassMock(...args),
}));

vi.mock('@/api/canvasPractice', () => ({
  generateCanvasPractice: (...args: unknown[]) => generateCanvasPracticeMock(...args),
  createCanvasPractice: (...args: unknown[]) => createCanvasPracticeMock(...args),
}));

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({
    lang: 'en',
    t: (key: string) => key,
  }),
}));

const TEACHER_CLASS: TeacherClassSummary = {
  id: 'class-1',
  orgId: 'org-1',
  name: 'French 2 - Period 3',
  term: 'Spring 2026',
  subject: 'French',
  learningLocale: 'fr-FR',
  status: 'active',
  studentCount: 12,
  assignmentCount: 0,
};

const CANVAS_ITEMS: CanvasCourseContentItem[] = [
  {
    id: 'canvas-content-1',
    connectionId: 'conn-1',
    classId: 'class-1',
    canvasModuleId: 'mod-1',
    canvasModuleName: 'Unit 1: Restaurants',
    canvasModulePosition: 1,
    canvasItemId: 'item-1',
    title: 'Intro: Reading a French menu',
    itemType: 'Page',
    itemPosition: 1,
    dueAt: null,
    pointsPossible: null,
    htmlUrl: null,
    lingualAssignmentId: null,
  },
  {
    id: 'canvas-content-2',
    connectionId: 'conn-1',
    classId: 'class-1',
    canvasModuleId: 'mod-1',
    canvasModuleName: 'Unit 1: Restaurants',
    canvasModulePosition: 1,
    canvasItemId: 'item-2',
    title: 'Ordering dinner: speaking practice',
    itemType: 'Assignment',
    itemPosition: 2,
    dueAt: null,
    pointsPossible: null,
    htmlUrl: null,
    lingualAssignmentId: null,
  },
];

describe('TeacherAssignmentBuilderPage', () => {
  let assignments: StudentAssignmentSummary[] = [];

  beforeEach(() => {
    navigateMock.mockReset();
    getTeacherClassesMock.mockReset();
    getTeacherAssignmentsMock.mockReset();
    createAssignmentMock.mockReset();
    generateAssignmentDraftMock.mockReset();
    getCanvasContentForClassMock.mockReset();
    generateCanvasPracticeMock.mockReset();
    createCanvasPracticeMock.mockReset();

    assignments = [];

    getTeacherClassesMock.mockResolvedValue([TEACHER_CLASS]);
    getTeacherAssignmentsMock.mockImplementation(async () => assignments);
    getCanvasContentForClassMock.mockResolvedValue([]);
  });

  it('Quick Assign shows an empty state when no Canvas course is connected', async () => {
    getCanvasContentForClassMock.mockResolvedValue([]);

    render(<TeacherAssignmentBuilderPage />);

    await waitFor(() => {
      expect(screen.getByText('French 2 - Period 3')).toBeInTheDocument();
    });

    // Quick Assign is the default mode; empty-state messaging appears.
    expect(screen.getByText('Connect a Canvas course first')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect Canvas' })).toBeInTheDocument();
  });

  it('Quick Assign: generates from Canvas, edits, and publishes', async () => {
    getCanvasContentForClassMock.mockResolvedValue(CANVAS_ITEMS);
    generateCanvasPracticeMock.mockResolvedValue({
      success: true,
      canvasItem: {
        id: 'canvas-content-2',
        title: 'Ordering dinner: speaking practice',
        type: 'Assignment',
        moduleName: 'Unit 1: Restaurants',
        canvasItemId: 'item-2',
      },
      suggestions: {
        scenario: 'You are at a Parisian bistro ordering dinner with a friend.',
        targetExpressions: ["Je voudrais…", "L'addition, s'il vous plaît"],
        targetVocabulary: ['entrée', 'serveur'],
        focusGrammar: ['conditional polite requests'],
        successCriteria: ['Order at least two items', 'Ask one follow-up question'],
        taskType: 'decision_making',
        suggestedTitle: 'Dinner at the bistro',
        suggestedDescription: 'Order a two-course dinner and negotiate with the server.',
        teacherNotes: 'Keep learners in the restaurant register.',
      },
    });
    createCanvasPracticeMock.mockResolvedValue({
      success: true,
      assignmentId: 'assignment-1',
      status: 'published',
    });

    render(<TeacherAssignmentBuilderPage />);

    await waitFor(() => {
      expect(screen.getByText('French 2 - Period 3')).toBeInTheDocument();
    });

    // Canvas picker should be visible in Quick Assign.
    const picker = await screen.findByLabelText('Canvas item');
    fireEvent.change(picker, { target: { value: 'canvas-content-2' } });

    // Generate
    fireEvent.click(screen.getByRole('button', { name: /Generate practice from this item/i }));

    await waitFor(() => {
      expect(generateCanvasPracticeMock).toHaveBeenCalledWith('class-1', 'canvas-content-2');
    });

    // Review form renders with the suggested title pre-filled.
    const titleInput = await screen.findByDisplayValue('Dinner at the bistro');
    fireEvent.change(titleInput, { target: { value: 'Dinner at the bistro (edited)' } });
    expect(screen.queryByText('Task type')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Teacher notes')).toHaveAttribute('rows', '8');

    // Status defaults to Draft. Explicitly flip to Published before publishing.
    fireEvent.click(screen.getByRole('radio', { name: 'Published' }));

    // Publish.
    fireEvent.click(screen.getByRole('button', { name: /Publish assignment/i }));

    await waitFor(() => {
      expect(createCanvasPracticeMock).toHaveBeenCalledTimes(1);
    });

    const quickAssignPayload = createCanvasPracticeMock.mock.calls[0][1];
    expect(quickAssignPayload).toEqual(
      expect.objectContaining({
        canvasContentId: 'canvas-content-2',
        canvasModuleItemId: 'item-2',
        title: 'Dinner at the bistro (edited)',
        description: 'Order a two-course dinner and negotiate with the server.',
        scenario: 'You are at a Parisian bistro ordering dinner with a friend.',
        targetExpressions: ["Je voudrais…", "L'addition, s'il vous plaît"],
        targetVocabulary: ['entrée', 'serveur'],
        focusGrammar: ['conditional polite requests'],
        successCriteria: ['Order at least two items', 'Ask one follow-up question'],
        status: 'published',
      })
    );
    expect(quickAssignPayload).not.toHaveProperty('taskType');
    expect(quickAssignPayload).toEqual(
      expect.objectContaining({
        targetVocabulary: ['entrée', 'serveur'],
      })
    );

    // After publish the Your assignments card should refresh and include the new assignment.
    assignments = [
      {
        id: 'assignment-1',
        orgId: 'org-1',
        classId: 'class-1',
        title: 'Dinner at the bistro (edited)',
        description: 'Order a two-course dinner and negotiate with the server.',
        status: 'published',
        taskType: 'decision_making',
        successCriteria: ['Order at least two items'],
        modalityOverride: { mode: 'hybrid', voiceMinutesCap: null, textFallbackEnabled: true },
        createdByUid: 'teacher-1',
        className: 'French 2 - Period 3',
      },
    ];

    // The success banner should render.
    await waitFor(() => {
      const banner = screen.getByText(/has been published/i);
      expect(banner).toBeInTheDocument();
      expect(within(banner).queryByText(/Dinner at the bistro \(edited\)/)).not.toBeNull();
    });
  });

  it('Canvas form: objectives chip list flows into the create payload', async () => {
    getCanvasContentForClassMock.mockResolvedValue(CANVAS_ITEMS);
    generateCanvasPracticeMock.mockResolvedValue({
      success: true,
      canvasItem: {
        id: 'canvas-content-2',
        title: 'Ordering dinner: speaking practice',
        type: 'Assignment',
        moduleName: 'Unit 1: Restaurants',
        canvasItemId: 'item-2',
      },
      suggestions: {
        scenario: 'You are at a Parisian bistro ordering dinner with a friend.',
        targetExpressions: ['Je voudrais…'],
        targetVocabulary: [],
        focusGrammar: ['conditional polite requests'],
        successCriteria: ['Order at least two items'],
        taskType: 'decision_making',
        suggestedTitle: 'Dinner at the bistro',
        suggestedDescription: 'Order a two-course dinner.',
        teacherNotes: '',
        // objectives field in suggestions — may or may not be returned
        // by backend; test independently that teacher can add them.
      },
    });
    createCanvasPracticeMock.mockResolvedValue({
      success: true,
      assignmentId: 'assignment-2',
      status: 'draft',
    });

    render(<TeacherAssignmentBuilderPage />);

    await waitFor(() => {
      expect(screen.getByText('French 2 - Period 3')).toBeInTheDocument();
    });

    const picker = await screen.findByLabelText('Canvas item');
    fireEvent.change(picker, { target: { value: 'canvas-content-2' } });
    fireEvent.click(screen.getByRole('button', { name: /Generate practice from this item/i }));

    await waitFor(() => {
      expect(generateCanvasPracticeMock).toHaveBeenCalled();
    });

    // Add an objective through the TagListEditor. The "new" input for each
    // editor is the Input with aria-label `New <label>`.
    const objectivesInput = await screen.findByLabelText('New Objectives');
    fireEvent.change(objectivesInput, { target: { value: 'Order a full meal in French' } });
    fireEvent.keyDown(objectivesInput, { key: 'Enter' });
    const vocabularyInput = await screen.findByLabelText('New Target vocabulary');
    fireEvent.change(vocabularyInput, { target: { value: 'la carte' } });
    fireEvent.keyDown(vocabularyInput, { key: 'Enter' });

    // Publish as draft (default).
    fireEvent.click(screen.getByRole('button', { name: /Save as draft/i }));

    await waitFor(() => {
      expect(createCanvasPracticeMock).toHaveBeenCalled();
    });

    expect(createCanvasPracticeMock).toHaveBeenCalledWith(
      'class-1',
      expect.objectContaining({
        objectives: ['Order a full meal in French'],
        targetVocabulary: ['la carte'],
        status: 'draft',
      }),
    );
  });

  it('Advanced AI-assisted mode generates a draft from pasted source text and saves via direct assignment create', async () => {
    getCanvasContentForClassMock.mockResolvedValue(CANVAS_ITEMS);
    generateAssignmentDraftMock.mockResolvedValue({
      success: true,
      suggestions: {
        scenario: 'Students use the pasted vocabulary packet to prepare for a restaurant role-play.',
        targetExpressions: ['Quisiera...', 'La cuenta, por favor'],
        targetVocabulary: ['reservar', 'camarero'],
        focusGrammar: ['conditional politeness'],
        successCriteria: ['Use at least two source expressions'],
        taskType: 'information_gap',
        suggestedTitle: 'Restaurant vocabulary rehearsal',
        suggestedDescription: 'Use the pasted source packet to guide a speaking exchange.',
        teacherNotes: 'Push learners to cite the pasted vocabulary naturally.',
      },
    });
    createAssignmentMock.mockResolvedValue({
      id: 'assignment-3',
      orgId: 'org-1',
      classId: 'class-1',
      title: 'Restaurant vocabulary rehearsal',
      description: 'Use the pasted source packet to guide a speaking exchange.',
      status: 'draft',
      taskType: 'information_gap',
      successCriteria: ['Use at least two source expressions'],
      modalityOverride: { mode: 'hybrid', voiceMinutesCap: null, textFallbackEnabled: true },
      createdByUid: 'teacher-1',
    });

    render(<TeacherAssignmentBuilderPage />);

    await waitFor(() => {
      expect(screen.getByText('French 2 - Period 3')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Custom Instruction' }));
    fireEvent.change(screen.getByLabelText('Source packet'), {
      target: { value: 'Key vocabulary: reservar, camarero, cuenta. Rubric note: ask for clarification politely.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Generate draft from source/i }));

    await waitFor(() => {
      expect(generateAssignmentDraftMock).toHaveBeenCalledWith(
        'class-1',
        'Key vocabulary: reservar, camarero, cuenta. Rubric note: ask for clarification politely.',
      );
    });

    expect(await screen.findByDisplayValue('Restaurant vocabulary rehearsal')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Save as draft/i }));

    await waitFor(() => {
      expect(createAssignmentMock).toHaveBeenCalledTimes(1);
    });

    expect(createAssignmentMock).toHaveBeenCalledWith(
      'class-1',
      expect.objectContaining({
        title: 'Restaurant vocabulary rehearsal',
        description: 'Use the pasted source packet to guide a speaking exchange.',
        instructions: 'Key vocabulary: reservar, camarero, cuenta. Rubric note: ask for clarification politely.',
        generatedScenario: 'Students use the pasted vocabulary packet to prepare for a restaurant role-play.',
        targetExpressions: ['Quisiera...', 'La cuenta, por favor'],
        targetVocabulary: ['reservar', 'camarero'],
        focusGrammar: ['conditional politeness'],
        successCriteria: ['Use at least two source expressions'],
        teacherNotes: 'Push learners to cite the pasted vocabulary naturally.',
        status: 'draft',
      }),
    );
    expect(createAssignmentMock.mock.calls[0][1]).not.toHaveProperty('taskType');
  });

  it('Advanced manual mode creates an assignment without Canvas selection', async () => {
    getCanvasContentForClassMock.mockResolvedValue(CANVAS_ITEMS);
    createAssignmentMock.mockResolvedValue({
      id: 'assignment-4',
      orgId: 'org-1',
      classId: 'class-1',
      title: 'Manual speaking task',
      description: '',
      status: 'draft',
      taskType: 'opinion_gap',
      successCriteria: [],
      modalityOverride: { mode: 'hybrid', voiceMinutesCap: null, textFallbackEnabled: true },
      createdByUid: 'teacher-1',
    });

    render(<TeacherAssignmentBuilderPage />);

    await waitFor(() => {
      expect(screen.getByText('French 2 - Period 3')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Manual authoring' }));
    fireEvent.change(screen.getByLabelText('Assignment title'), {
      target: { value: 'Manual speaking task' },
    });
    fireEvent.change(screen.getByLabelText('Instructions'), {
      target: { value: 'Discuss your food preferences using full sentences.' },
    });
    fireEvent.change(screen.getByLabelText('Conversation scenario'), {
      target: { value: 'You and a classmate are deciding what to order for lunch.' },
    });
    expect(screen.queryByText('Task type')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Teacher notes')).toHaveAttribute('rows', '8');
    fireEvent.click(screen.getByRole('button', { name: /Save as draft/i }));

    await waitFor(() => {
      expect(createAssignmentMock).toHaveBeenCalledTimes(1);
    });

    expect(createAssignmentMock).toHaveBeenCalledWith(
      'class-1',
      expect.objectContaining({
        title: 'Manual speaking task',
        instructions: 'Discuss your food preferences using full sentences.',
        generatedScenario: 'You and a classmate are deciding what to order for lunch.',
        status: 'draft',
      }),
    );
    expect(createAssignmentMock.mock.calls[0][1]).not.toHaveProperty('taskType');
    expect(generateCanvasPracticeMock).not.toHaveBeenCalled();
    expect(generateAssignmentDraftMock).not.toHaveBeenCalled();
    expect(createCanvasPracticeMock).not.toHaveBeenCalled();
  });
});
