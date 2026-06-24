import { type ReactNode, type RefObject, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { BookOpen, ChevronDown, ChevronLeft, ChevronRight, Hand, History, Loader2, MessageSquareText, Mic } from 'lucide-react';
import {
  createAssignmentPracticeSession,
  getStudentAssignmentWorkspace,
  reportPracticeSessionEvent,
} from '@/api/assignments';
import { createChatSession, getChatSession, saveMessageToChat, sendChatMessage } from '@/api/chat';
import { ChatInput, ChatMessage, SpeakingSpeedControl } from '@/components/chat';
import { getCoachChips, postCoachChip, type CoachChip } from '@/api/coachChips';
import { ConversationSidecar } from '@/components/learning/ConversationSidecar';
import { ReviewLauncher } from '@/components/learning/ReviewLauncher';
import { Alert, AlertDescription, Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui';
import { useLanguage } from '@/contexts/LanguageContext';
import { useRealtimeChat } from '@/hooks/useRealtimeChat';
import { useRealtimeSpeakingSpeed } from '@/hooks/useRealtimeSpeakingSpeed';
import type { AssignmentBootstrapData, AssignmentWorkspaceData, ChatMessage as ChatMessageType, Language, PracticeSessionDto } from '@/types';
import { AssignmentContextPanel } from './AssignmentContextPanel';
import { AssignmentThreadSidebar } from './AssignmentThreadSidebar';

interface AssignmentPracticeWorkspaceProps {
  open: boolean;
  bootstrap: AssignmentBootstrapData | null;
  onClose: () => void;
}

function buildRealtimeSessionParams(
  bootstrap: AssignmentBootstrapData,
  practiceSession?: PracticeSessionDto | null,
) {
  return {
    ...bootstrap.realtimeSessionParams,
    practice: {
      ...bootstrap.realtimeSessionParams.practice,
      ...(practiceSession ? { practiceSessionId: practiceSession.id } : {}),
    },
  };
}

async function queuePracticeEvent(
  practiceSessionId: string,
  eventType: string,
  turnIndex: number | null,
  payload: Record<string, unknown>,
) {
  await reportPracticeSessionEvent(practiceSessionId, {
    eventType,
    turnIndex,
    payload,
  });
}

function mergeActivePracticeSessionIntoWorkspace(
  workspace: AssignmentWorkspaceData,
  practiceSession: PracticeSessionDto | null | undefined,
  fallbackTitle: string,
): AssignmentWorkspaceData {
  const chatId = practiceSession?.chatId?.trim();
  if (!chatId || practiceSession?.status !== 'active') {
    return workspace;
  }

  let foundThread = false;
  const threads = workspace.threads.map((thread) => {
    const attemptsWithoutDuplicate = thread.attempts.reduce<typeof thread.attempts>((acc, attempt) => {
      if (attempt.id === practiceSession.id) {
        return acc;
      }
      acc.push(attempt.status === 'active' ? { ...attempt, status: 'completed' } : attempt);
      return acc;
    }, []);

    if (thread.chatId !== chatId) {
      const latestPracticeSession = thread.latestPracticeSession?.status === 'active'
        ? { ...thread.latestPracticeSession, status: 'completed' }
        : thread.latestPracticeSession;
      return {
        ...thread,
        latestPracticeSession,
        attempts: attemptsWithoutDuplicate,
        hasActiveAttempt: false,
      };
    }

    foundThread = true;
    return {
      ...thread,
      hasActiveAttempt: true,
      latestPracticeSession: practiceSession,
      attempts: [practiceSession, ...attemptsWithoutDuplicate],
    };
  });

  if (!foundThread) {
    threads.unshift({
      chatId,
      title: fallbackTitle,
      updatedAt: practiceSession.startedAt ?? null,
      messageCount: 0,
      hasActiveAttempt: true,
      latestPracticeSession: practiceSession,
      attempts: [practiceSession],
    });
  }

  return {
    ...workspace,
    selectedChatId: chatId,
    latestActivePracticeSessionId: practiceSession.id,
    threads,
  };
}

type AssignmentThread = AssignmentWorkspaceData['threads'][number];

interface AssignmentWorkspaceState {
  workspace: AssignmentWorkspaceData | null;
  selectedChatId: string | null;
  historyMessages: ChatMessageType[];
  loading: boolean;
  loadingChat: boolean;
  isMutating: boolean;
  isConnecting: boolean;
  isSendingText: boolean;
  isSidebarExpanded: boolean;
  isScopeExpanded: boolean;
  isHistoryExpanded: boolean;
  textInput: string;
  error: string | null;
}

type AssignmentWorkspaceAction =
  | { type: 'patch'; payload: Partial<AssignmentWorkspaceState> }
  | { type: 'workspaceLoaded'; workspace: AssignmentWorkspaceData; selectedChatId: string | null }
  | { type: 'mergeActivePracticeSession'; practiceSession: PracticeSessionDto; fallbackTitle: string; selectedChatId: string | null }
  | { type: 'toggleSidebar' }
  | { type: 'toggleScope' }
  | { type: 'toggleHistory' }
  | { type: 'appendHistoryMessages'; messages: ChatMessageType[] };

const initialAssignmentWorkspaceState: AssignmentWorkspaceState = {
  workspace: null,
  selectedChatId: null,
  historyMessages: [],
  loading: false,
  loadingChat: false,
  isMutating: false,
  isConnecting: false,
  isSendingText: false,
  isSidebarExpanded: true,
  isScopeExpanded: true,
  isHistoryExpanded: true,
  textInput: '',
  error: null,
};

function assignmentWorkspaceReducer(
  state: AssignmentWorkspaceState,
  action: AssignmentWorkspaceAction,
): AssignmentWorkspaceState {
  switch (action.type) {
    case 'patch':
      return { ...state, ...action.payload };
    case 'workspaceLoaded':
      return {
        ...state,
        workspace: action.workspace,
        selectedChatId: action.selectedChatId,
      };
    case 'mergeActivePracticeSession':
      return {
        ...state,
        workspace: state.workspace
          ? mergeActivePracticeSessionIntoWorkspace(state.workspace, action.practiceSession, action.fallbackTitle)
          : state.workspace,
        selectedChatId: action.selectedChatId,
      };
    case 'toggleSidebar':
      return { ...state, isSidebarExpanded: !state.isSidebarExpanded };
    case 'toggleScope':
      return { ...state, isScopeExpanded: !state.isScopeExpanded };
    case 'toggleHistory':
      return { ...state, isHistoryExpanded: !state.isHistoryExpanded };
    case 'appendHistoryMessages':
      return { ...state, historyMessages: [...state.historyMessages, ...action.messages] };
    default:
      return state;
  }
}

interface SidebarExpansionState {
  sidebar: boolean;
  scope: boolean;
  history: boolean;
}

interface CollapsibleSidebarSectionProps {
  icon: ReactNode;
  title: string;
  description: string;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
  contentClassName?: string;
}

function CollapsibleSidebarSection({
  icon,
  title,
  description,
  expanded,
  onToggle,
  children,
  contentClassName = 'p-3',
}: CollapsibleSidebarSectionProps) {
  return (
    <section className="overflow-hidden rounded-2xl border-2 border-border bg-card">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/50"
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border-2 border-border bg-secondary text-foreground">
            {icon}
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-foreground">{title}</span>
            <span className="block truncate text-xs text-muted-foreground">{description}</span>
          </span>
        </span>
        <ChevronDown
          className={`size-4 shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>
      {expanded ? (
        <div className={`border-t-2 border-border ${contentClassName}`}>
          {children}
        </div>
      ) : null}
    </section>
  );
}

interface CollapsedAssignmentSidebarActionsProps {
  onOpenScope: () => void;
  onOpenHistory: () => void;
}

function CollapsedAssignmentSidebarActions({
  onOpenScope,
  onOpenHistory,
}: CollapsedAssignmentSidebarActionsProps) {
  return (
    <div className="hidden min-h-0 flex-1 flex-col items-center gap-3 px-3 py-4 lg:flex">
      <button
        type="button"
        onClick={onOpenScope}
        aria-label="Open assignment scope"
        className="flex size-10 items-center justify-center rounded-xl border-2 border-border bg-card text-foreground transition-colors hover:bg-secondary"
      >
        <BookOpen className="size-4" />
      </button>
      <button
        type="button"
        onClick={onOpenHistory}
        aria-label="Open chat history"
        className="flex size-10 items-center justify-center rounded-xl border-2 border-border bg-card text-foreground transition-colors hover:bg-secondary"
      >
        <History className="size-4" />
      </button>
    </div>
  );
}

interface AssignmentWorkspaceSidebarProps {
  bootstrap: AssignmentBootstrapData;
  workspace: AssignmentWorkspaceData;
  lang: Language;
  selectedChatId: string | null;
  expansion: SidebarExpansionState;
  onToggleSidebar: () => void;
  onToggleScope: () => void;
  onToggleHistory: () => void;
  onOpenScope: () => void;
  onOpenHistory: () => void;
  onSelectThread: (chatId: string) => void;
  onNewAttempt: () => void;
}

function AssignmentWorkspaceSidebar({
  bootstrap,
  workspace,
  lang,
  selectedChatId,
  expansion,
  onToggleSidebar,
  onToggleScope,
  onToggleHistory,
  onOpenScope,
  onOpenHistory,
  onSelectThread,
  onNewAttempt,
}: AssignmentWorkspaceSidebarProps) {
  return (
    <aside
      className={`flex min-h-0 shrink-0 flex-col border-b-2 border-border bg-secondary/20 transition-[height,width] duration-200 lg:h-full lg:border-b-0 lg:border-r-2 ${
        expansion.sidebar
          ? 'max-lg:max-h-[50%] lg:basis-1/2'
          : 'max-lg:h-[4.5rem] lg:basis-[4.5rem]'
      }`}
    >
      <div className="flex shrink-0 items-center justify-between gap-3 border-b-2 border-border bg-card p-3">
        {expansion.sidebar ? (
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Assignment workspace
            </p>
            <p className="mt-1 truncate text-sm font-semibold text-foreground">
              Scope and attempt history
            </p>
          </div>
        ) : (
          <span className="sr-only">Assignment workspace sidebar</span>
        )}
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={onToggleSidebar}
          aria-label={expansion.sidebar ? 'Collapse assignment sidebar' : 'Expand assignment sidebar'}
          className="size-10 shrink-0 border-2 shadow-none"
        >
          {expansion.sidebar ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
        </Button>
      </div>

      {expansion.sidebar ? (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 sm:p-4">
          <CollapsibleSidebarSection
            icon={<BookOpen className="size-4" />}
            title="Assignment scope"
            description="Objectives, scenario, teacher guidance"
            expanded={expansion.scope}
            onToggle={onToggleScope}
            contentClassName="max-h-[34vh] overflow-y-auto p-3"
          >
            <AssignmentContextPanel bootstrap={bootstrap} lang={lang} />
          </CollapsibleSidebarSection>

          <CollapsibleSidebarSection
            icon={<History className="size-4" />}
            title="Chat history"
            description="Assignment-only attempts and resumes"
            expanded={expansion.history}
            onToggle={onToggleHistory}
          >
            <AssignmentThreadSidebar
              threads={workspace.threads}
              selectedChatId={selectedChatId}
              onSelectThread={onSelectThread}
              onNewAttempt={onNewAttempt}
            />
          </CollapsibleSidebarSection>
        </div>
      ) : (
        <CollapsedAssignmentSidebarActions onOpenScope={onOpenScope} onOpenHistory={onOpenHistory} />
      )}
    </aside>
  );
}

interface AssignmentConversationHeaderProps {
  selectedThread: AssignmentThread | null;
  selectedActivePracticeSession: PracticeSessionDto | null;
  onEndSession: () => void;
  status: {
    isMutating: boolean;
    isConnecting: boolean;
    isConnected: boolean;
    isListening: boolean;
    isSpeaking: boolean;
  };
}

function AssignmentConversationHeader({
  selectedThread,
  selectedActivePracticeSession,
  onEndSession,
  status,
}: AssignmentConversationHeaderProps) {
  return (
    <div className="shrink-0 border-b-2 border-border px-4 py-4 sm:px-6">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Conversation</p>
      <div className="mt-2 flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold text-foreground">
          {selectedThread?.title || 'Select a thread'}
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          {selectedActivePracticeSession ? (
            <Button size="sm" variant="outline" onClick={onEndSession} disabled={status.isMutating}>
              End session
            </Button>
          ) : null}
        </div>
      </div>
      {selectedActivePracticeSession ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Status: {selectedActivePracticeSession.status} · Voice {selectedActivePracticeSession.voiceEnabled ? 'on' : 'off'} ·
          Text {selectedActivePracticeSession.textEnabled ? 'on' : 'off'} ·
          Connected {status.isConnecting ? 'connecting' : status.isConnected ? 'yes' : 'no'} ·
          Listening {status.isListening ? 'yes' : 'no'} · Speaking {status.isSpeaking ? 'yes' : 'no'}
        </p>
      ) : null}
    </div>
  );
}

interface AssignmentMessagesPaneProps {
  loadingChat: boolean;
  messages: ChatMessageType[];
}

function AssignmentMessagesPane({ loadingChat, messages }: AssignmentMessagesPaneProps) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-secondary/30 px-4 py-4 sm:px-6">
      {loadingChat ? (
        <div className="flex h-full min-h-[260px] items-center justify-center">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : messages.length > 0 ? (
        <div className="space-y-3">
          {messages.map((message) => (
            <ChatMessage key={message.id} role={message.role} content={message.content} />
          ))}
        </div>
      ) : (
        <div className="flex min-h-[260px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border bg-secondary/20 px-6 text-center">
          <MessageSquareText className="size-6 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            Open a thread to review assignment conversation history.
          </p>
        </div>
      )}
    </div>
  );
}

interface HoldButtonLabels {
  release: string;
  active: string;
  inactive: string;
}

interface AssignmentComposerState {
  canUseVoice: boolean;
  canUseText: boolean;
  isConnecting: boolean;
  isMutating: boolean;
  isConnected: boolean;
  isTutorHoldActive: boolean;
  hasHeldTutorResponse: boolean;
  isSendingText: boolean;
  speakingSpeed: number;
  textInput: string;
  voiceStatusLabel: string;
}

interface AssignmentComposerPanelProps {
  state: AssignmentComposerState;
  holdLabels: HoldButtonLabels;
  selectedActivePracticeSession: PracticeSessionDto | null;
  selectedChatId: string | null;
  onSpeakingSpeedChange: (nextSpeed: number) => void;
  onTutorHoldChange: (nextValue: boolean) => void;
  onVoiceToggle: () => void;
  onTextChange: (nextText: string) => void;
  onSendText: () => void;
}

function AssignmentComposerPanel({
  state,
  holdLabels,
  selectedActivePracticeSession,
  selectedChatId,
  onSpeakingSpeedChange,
  onTutorHoldChange,
  onVoiceToggle,
  onTextChange,
  onSendText,
}: AssignmentComposerPanelProps) {
  return (
    <div className="shrink-0 space-y-3 border-t-2 border-border bg-card px-4 py-4 sm:px-6">
      {state.canUseVoice ? (
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <SpeakingSpeedControl
              value={state.speakingSpeed}
              onChange={onSpeakingSpeedChange}
              disabled={state.isConnecting || state.isMutating}
            />
            <div className="flex min-h-12 items-center rounded-2xl border-2 border-border bg-background px-4 text-sm font-semibold text-muted-foreground">
              {state.voiceStatusLabel}
            </div>
          </div>
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => onTutorHoldChange(!state.isTutorHoldActive)}
              disabled={!state.isConnected || state.isConnecting || state.isMutating}
              aria-pressed={state.isTutorHoldActive}
              aria-label={state.isTutorHoldActive ? holdLabels.release : holdLabels.inactive}
              title={state.isTutorHoldActive ? holdLabels.release : holdLabels.inactive}
              className={`flex h-14 shrink-0 items-center gap-2 rounded-2xl border-3 border-foreground px-3 text-sm font-bold transition-all ${
                state.isTutorHoldActive
                  ? 'bg-warning text-warning-foreground shadow-stamp'
                  : 'bg-background text-foreground hover:-translate-y-0.5 hover:shadow-[6px_6px_0_0_var(--foreground)]'
              } disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none`}
            >
              <Hand className="size-5" />
              <span className="hidden sm:inline">
                {state.isTutorHoldActive
                  ? state.hasHeldTutorResponse
                    ? holdLabels.release
                    : holdLabels.active
                  : holdLabels.inactive}
              </span>
            </button>
            <button
              type="button"
              onClick={onVoiceToggle}
              disabled={state.isConnecting || state.isMutating}
              aria-label={state.voiceStatusLabel}
              className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border-3 border-foreground transition-all ${
                state.isConnected
                  ? 'bg-success text-success-foreground shadow-stamp'
                  : 'bg-primary text-primary-foreground shadow-stamp hover:-translate-y-0.5 hover:shadow-[6px_6px_0_0_var(--foreground)]'
              } disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none`}
            >
              {state.isConnecting ? <Loader2 className="size-5 animate-spin" /> : <Mic className="size-5" />}
            </button>
          </div>
        </div>
      ) : null}

      {state.canUseText ? (
        <ChatInput
          value={state.textInput}
          onChange={onTextChange}
          onSend={onSendText}
          disabled={state.isSendingText || state.isMutating || !selectedChatId}
          placeholder={
            selectedActivePracticeSession
              ? 'Type your assignment response...'
              : 'Type to continue this assignment thread...'
          }
        />
      ) : null}
    </div>
  );
}

interface AssignmentConversationViewProps {
  selectedThread: AssignmentThread | null;
  selectedActivePracticeSession: PracticeSessionDto | null;
  selectedChatId: string | null;
  messages: ChatMessageType[];
  loadingChat: boolean;
  reviewSessionId: string | null;
  canReview: boolean;
  coachChips: CoachChip[];
  askModeEnabled: boolean;
  currentTurnIndex?: number | null;
  status: AssignmentConversationHeaderProps['status'];
  composerState: AssignmentComposerState;
  holdLabels: HoldButtonLabels;
  onEndSession: () => void;
  onSpeakingSpeedChange: (nextSpeed: number) => void;
  onTutorHoldChange: (nextValue: boolean) => void;
  onVoiceToggle: () => void;
  onTextChange: (nextText: string) => void;
  onSendText: () => void;
}

function AssignmentConversationView({
  selectedThread,
  selectedActivePracticeSession,
  selectedChatId,
  messages,
  loadingChat,
  reviewSessionId,
  canReview,
  coachChips,
  askModeEnabled,
  currentTurnIndex,
  status,
  composerState,
  holdLabels,
  onEndSession,
  onSpeakingSpeedChange,
  onTutorHoldChange,
  onVoiceToggle,
  onTextChange,
  onSendText,
}: AssignmentConversationViewProps) {
  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-card">
      <AssignmentConversationHeader
        selectedThread={selectedThread}
        selectedActivePracticeSession={selectedActivePracticeSession}
        onEndSession={onEndSession}
        status={status}
      />
      <AssignmentMessagesPane loadingChat={loadingChat} messages={messages} />
      <ReviewLauncher sessionId={reviewSessionId} canReview={canReview} label="See coach review" />
      <ConversationSidecar
        chips={coachChips}
        sessionId={selectedActivePracticeSession?.id ?? null}
        askModeEnabled={askModeEnabled}
        currentTurnIndex={currentTurnIndex}
      />
      {selectedThread ? (
        <AssignmentComposerPanel
          state={composerState}
          holdLabels={holdLabels}
          selectedActivePracticeSession={selectedActivePracticeSession}
          selectedChatId={selectedChatId}
          onSpeakingSpeedChange={onSpeakingSpeedChange}
          onTutorHoldChange={onTutorHoldChange}
          onVoiceToggle={onVoiceToggle}
          onTextChange={onTextChange}
          onSendText={onSendText}
        />
      ) : null}
    </main>
  );
}

interface AssignmentPracticeWorkspaceController {
  lang: Language;
  workspace: AssignmentWorkspaceData | null;
  selectedChatId: string | null;
  selectedThread: AssignmentThread | null;
  selectedActivePracticeSession: PracticeSessionDto | null;
  loading: boolean;
  loadingChat: boolean;
  error: string | null;
  reviewSessionId: string | null;
  canReview: boolean;
  coachChips: CoachChip[];
  lastLearnerTurnIndexRef: RefObject<number | null>;
  displayMessages: ChatMessageType[];
  sidebarExpansion: SidebarExpansionState;
  conversationStatus: AssignmentConversationHeaderProps['status'];
  composerState: AssignmentComposerState;
  holdLabels: HoldButtonLabels;
  handleClose: () => void;
  handleToggleSidebar: () => void;
  handleToggleScope: () => void;
  handleToggleHistory: () => void;
  handleOpenScope: () => void;
  handleOpenHistory: () => void;
  handleSelectThread: (nextChatId: string) => void;
  handleNewAttempt: () => Promise<void>;
  handleEndSession: () => Promise<void>;
  handleSpeakingSpeedChange: (nextSpeed: number) => void;
  setTutorHoldActive: (nextValue: boolean) => void;
  handleVoiceToggle: () => Promise<void>;
  handleTextChange: (nextText: string) => void;
  handleSendText: () => Promise<void>;
}

function useAssignmentPracticeWorkspaceController({
  open,
  bootstrap,
  onClose,
}: AssignmentPracticeWorkspaceProps): AssignmentPracticeWorkspaceController {
  const { lang, t } = useLanguage();
  const [state, dispatch] = useReducer(assignmentWorkspaceReducer, initialAssignmentWorkspaceState);
  const {
    workspace,
    selectedChatId,
    historyMessages,
    loading,
    loadingChat,
    isMutating,
    isConnecting,
    isSendingText,
    isSidebarExpanded,
    isScopeExpanded,
    isHistoryExpanded,
    textInput,
    error,
  } = state;
  const [speakingSpeed, setSpeakingSpeed] = useRealtimeSpeakingSpeed();
  const [reviewSessionId, setReviewSessionId] = useState<string | null>(null);
  const [coachChips, setCoachChips] = useState<CoachChip[]>([]);
  const lastLearnerTurnIndexRef = useRef<number | null>(null);
  const selectedChatIdRef = useRef<string | null>(null);
  const nextMessageOrderRef = useRef(0);
  const closeWithoutAbandonRef = useRef(false);
  const activePracticeSessionRef = useRef<PracticeSessionDto | null>(null);
  const realtimePersistenceTargetRef = useRef<{ practiceSessionId: string; chatId: string } | null>(null);
  const pendingPromoteBackRef = useRef<string | null>(null);
  const injectPromoteBackRef = useRef<((prompt: string) => void) | null>(null);

  const selectedThread = useMemo(
    () => workspace?.threads.find((thread) => thread.chatId === selectedChatId) ?? null,
    [workspace, selectedChatId],
  );

  const activePracticeSession = useMemo(
    () => workspace?.threads.flatMap((thread) => thread.attempts).find((attempt) => attempt.id === workspace.latestActivePracticeSessionId) ?? null,
    [workspace],
  );

  const selectedActivePracticeSession = useMemo(
    () => selectedThread?.attempts.find((attempt) => attempt.status === 'active') ?? null,
    [selectedThread],
  );

  useEffect(() => {
    selectedChatIdRef.current = selectedChatId;
  }, [selectedChatId]);

  useEffect(() => {
    activePracticeSessionRef.current = activePracticeSession;
  }, [activePracticeSession]);

  useEffect(() => {
    const sessionId = selectedActivePracticeSession?.id;
    setCoachChips([]);                 // reset for the new/!active session (fixes stale chips across session/thread switch)
    if (!sessionId) return;
    let cancelled = false;
    getCoachChips(sessionId)
      .then((persisted) => {
        if (cancelled) return;
        // merge persisted into current state, dedup by turn_index, so a chip that
        // was live-appended during the fetch is NOT clobbered by the hydration response
        setCoachChips((prev) => {
          const seen = new Set(prev.map((c) => c.turn_index));
          const merged = [...prev, ...persisted.filter((c) => !seen.has(c.turn_index))];
          return merged.sort((a, b) => a.turn_index - b.turn_index);
        });
      })
      .catch(() => { /* fail-open: no hydration on error, live chips still work */ });
    return () => { cancelled = true; };
  }, [selectedActivePracticeSession?.id]);

  const getActivePracticeSession = useCallback(() => activePracticeSessionRef.current, []);
  const getSelectedChatId = useCallback(() => selectedChatIdRef.current, []);
  const shouldCloseWithoutAbandon = useCallback(() => closeWithoutAbandonRef.current, []);

  const realtimeSessionParams = useMemo(
    () => (bootstrap ? buildRealtimeSessionParams(bootstrap, selectedActivePracticeSession) : undefined),
    [bootstrap, selectedActivePracticeSession],
  );

  const clearRealtimePersistenceTarget = () => {
    realtimePersistenceTargetRef.current = null;
  };

  const setRealtimePersistenceTarget = (practiceSession: PracticeSessionDto, chatId?: string | null) => {
    const resolvedChatId = (chatId ?? practiceSession.chatId ?? '').trim();
    if (!practiceSession.id || !resolvedChatId) {
      realtimePersistenceTargetRef.current = null;
      return;
    }
    realtimePersistenceTargetRef.current = {
      practiceSessionId: practiceSession.id,
      chatId: resolvedChatId,
    };
  };

  const triggerCoachChip = useCallback(async (learnerTurnIndex: number) => {
    const sessionId = activePracticeSessionRef.current?.id;
    if (!sessionId || learnerTurnIndex == null) return;
    try {
      const { chip, resteer } = await postCoachChip(sessionId, learnerTurnIndex);
      if (chip) {
        setCoachChips((prev) => (prev.some((c) => c.turn_index === chip.turn_index) ? prev : [...prev, chip]));
        if (chip.promote && chip.promote_prompt) {
          if (chip.surface === 'voice') {
            injectPromoteBackRef.current?.(chip.promote_prompt);
          } else {
            pendingPromoteBackRef.current = chip.promote_prompt;
          }
        }
      }
      // S5 Director: a re-steer rides the SAME channels as a promote.
      if (resteer && resteer.resteer_prompt) {
        if (resteer.surface === 'voice') {
          injectPromoteBackRef.current?.(resteer.resteer_prompt);
        } else {
          pendingPromoteBackRef.current = resteer.resteer_prompt;
        }
      }
    } catch {
      // fail-open: a missing/failed chip/resteer or injection never disrupts the session
    }
  }, []);

  const persistRealtimeMessage = async (role: 'user' | 'assistant', content: string) => {
    const persistenceTarget = realtimePersistenceTargetRef.current;
    if (!persistenceTarget || !content.trim()) return;

    const timestamp = new Date().toISOString();
    const sortOrder = nextMessageOrderRef.current;
    nextMessageOrderRef.current += 1;

    try {
      await saveMessageToChat(persistenceTarget.chatId, role, content, { timestamp, sortOrder });
      await queuePracticeEvent(
        persistenceTarget.practiceSessionId,
        role === 'user' ? 'student.turn' : 'assistant.turn',
        sortOrder,
        {
          chatId: persistenceTarget.chatId,
          content,
          source: 'realtime',
        },
      );
      if (role === 'user') {
        lastLearnerTurnIndexRef.current = sortOrder;
      } else if (lastLearnerTurnIndexRef.current != null) {
        void triggerCoachChip(lastLearnerTurnIndexRef.current);
      }
    } catch (saveError) {
      dispatch({
        type: 'patch',
        payload: { error: saveError instanceof Error ? saveError.message : 'Failed to save realtime assignment message.' },
      });
    }
  };

  const {
    isConnected,
    isListening,
    isSpeaking,
    messages: realtimeMessages,
    isTutorHoldActive,
    hasHeldTutorResponse,
    connect,
    disconnect,
    updateSpeakingSpeed,
    clearMessages,
    setTutorHoldActive,
    injectPromoteBack,
  } = useRealtimeChat({
    onMessage: (role, content) => {
      void persistRealtimeMessage(role, content);
    },
    sessionParams: realtimeSessionParams,
  });

  // Keep injectPromoteBackRef current so triggerCoachChip (defined before useRealtimeChat)
  // can call it without a forward-reference initialization error.
  injectPromoteBackRef.current = injectPromoteBack;

  const handleSpeakingSpeedChange = useCallback((nextSpeed: number) => {
    setSpeakingSpeed(nextSpeed);
    if (isConnected) {
      updateSpeakingSpeed(nextSpeed);
    }
  }, [isConnected, setSpeakingSpeed, updateSpeakingSpeed]);

  const loadWorkspace = useCallback(async (
    preferredChatId?: string | null,
    optimisticActiveSession?: PracticeSessionDto | null,
    optimisticThreadTitle = 'Assignment thread',
  ) => {
    if (!bootstrap) return;
    dispatch({ type: 'patch', payload: { loading: true, error: null } });
    try {
      const fetchedWorkspace = await getStudentAssignmentWorkspace(bootstrap.assignment.id);
      const nextWorkspace = optimisticActiveSession
        ? mergeActivePracticeSessionIntoWorkspace(fetchedWorkspace, optimisticActiveSession, optimisticThreadTitle)
        : fetchedWorkspace;
      const nextSelectedChatId = preferredChatId || nextWorkspace.selectedChatId || nextWorkspace.threads[0]?.chatId || null;
      dispatch({ type: 'workspaceLoaded', workspace: nextWorkspace, selectedChatId: nextSelectedChatId });
    } catch (loadError) {
      dispatch({
        type: 'patch',
        payload: { error: loadError instanceof Error ? loadError.message : 'Failed to load assignment workspace.' },
      });
    } finally {
      dispatch({ type: 'patch', payload: { loading: false } });
    }
  }, [bootstrap]);

  const applyOptimisticActivePracticeSession = (
    practiceSession: PracticeSessionDto,
    fallbackTitle: string,
  ) => {
    const nextChatId = practiceSession.chatId?.trim() || selectedChatIdRef.current || null;
    selectedChatIdRef.current = nextChatId;
    dispatch({
      type: 'mergeActivePracticeSession',
      practiceSession,
      fallbackTitle,
      selectedChatId: nextChatId,
    });
  };

  useEffect(() => {
    if (!open || !bootstrap) return;
    closeWithoutAbandonRef.current = false;
    void loadWorkspace();
  }, [open, bootstrap, loadWorkspace]);

  useEffect(() => {
    let isActive = true;
    if (!open || !selectedChatId) {
      return;
    }

    const loadChat = async () => {
      dispatch({ type: 'patch', payload: { loadingChat: true } });
      clearRealtimePersistenceTarget();
      clearMessages();
      disconnect();
      try {
        const chat = await getChatSession(selectedChatId);
        if (!isActive) return;
        const formattedMessages = chat.messages.map((message, index) => ({
          id: `${selectedChatId}-${index}`,
          role: message.role,
          content: message.content,
          timestamp: message.timestamp,
        }));
        nextMessageOrderRef.current = formattedMessages.length;
        dispatch({ type: 'patch', payload: { historyMessages: formattedMessages } });
      } catch (chatError) {
        if (!isActive) return;
        dispatch({
          type: 'patch',
          payload: { error: chatError instanceof Error ? chatError.message : 'Failed to load assignment thread.' },
        });
      } finally {
        if (isActive) dispatch({ type: 'patch', payload: { loadingChat: false } });
      }
    };

    void loadChat();
    return () => {
      isActive = false;
    };
  }, [open, selectedChatId, clearMessages, disconnect]);

  const endActivePracticeSession = async (reason: string) => {
    if (!activePracticeSession) return;
    await reportPracticeSessionEvent(activePracticeSession.id, {
      eventType: 'session.ended',
      payload: {
        reason,
        status: 'completed',
        chatId: activePracticeSession.chatId,
      },
    });
  };

  const ensureActivePracticeSessionForSelectedThread = async () => {
    if (selectedActivePracticeSession) return selectedActivePracticeSession;
    if (!bootstrap || !selectedThread) return null;

    clearRealtimePersistenceTarget();
    if (activePracticeSession) {
      await endActivePracticeSession('thread_resumed');
    }

    clearMessages();
    disconnect();
    const resumedPracticeSession = await createAssignmentPracticeSession(bootstrap.assignment.id, {
      uiLanguage: lang,
      chatId: selectedThread.chatId,
    });
    const normalizedPracticeSession = resumedPracticeSession.chatId?.trim()
      ? resumedPracticeSession
      : { ...resumedPracticeSession, chatId: selectedThread.chatId };
    activePracticeSessionRef.current = normalizedPracticeSession;
    applyOptimisticActivePracticeSession(normalizedPracticeSession, selectedThread.title);
    return normalizedPracticeSession;
  };

  const handleNewAttempt = async () => {
    if (!bootstrap) return;
    dispatch({ type: 'patch', payload: { isMutating: true, error: null } });
    try {
      clearRealtimePersistenceTarget();
      if (activePracticeSession) {
        await endActivePracticeSession('restarted');
      }
      clearMessages();
      disconnect();
      const createdChat = await createChatSession(`ASM ${bootstrap.assignment.title}`);
      const createdPracticeSession = await createAssignmentPracticeSession(bootstrap.assignment.id, {
        uiLanguage: lang,
        chatId: createdChat.chatId,
      });
      await loadWorkspace(createdChat.chatId, createdPracticeSession, createdChat.title);
    } catch (mutationError) {
      dispatch({
        type: 'patch',
        payload: { error: mutationError instanceof Error ? mutationError.message : 'Failed to start a new attempt.' },
      });
    } finally {
      dispatch({ type: 'patch', payload: { isMutating: false } });
    }
  };

  const handleVoiceToggle = async () => {
    if (!bootstrap || !selectedThread || isConnecting || isMutating) return;
    dispatch({ type: 'patch', payload: { error: null } });

    if (isConnected) {
      clearRealtimePersistenceTarget();
      disconnect();
      return;
    }

    dispatch({ type: 'patch', payload: { isMutating: true, isConnecting: true } });
    try {
      const practiceSession = await ensureActivePracticeSessionForSelectedThread();
      if (!practiceSession) return;
      if (!practiceSession.voiceEnabled) {
        dispatch({ type: 'patch', payload: { error: 'Voice is not enabled for this assignment attempt.' } });
        return;
      }
      activePracticeSessionRef.current = practiceSession;
      selectedChatIdRef.current = practiceSession.chatId || selectedChatId;
      setRealtimePersistenceTarget(practiceSession, practiceSession.chatId || selectedChatId);
      await connect({
        ...buildRealtimeSessionParams(bootstrap, practiceSession),
        speakingSpeed,
      });
    } catch (mutationError) {
      clearRealtimePersistenceTarget();
      dispatch({
        type: 'patch',
        payload: { error: mutationError instanceof Error ? mutationError.message : 'Failed to connect assignment voice session.' },
      });
    } finally {
      dispatch({ type: 'patch', payload: { isConnecting: false, isMutating: false } });
    }
  };

  const handleEndSession = async () => {
    if (!selectedActivePracticeSession) return;
    const endedId = selectedActivePracticeSession.id; // capture before reload nulls the selector
    dispatch({ type: 'patch', payload: { isMutating: true, error: null } });
    try {
      clearRealtimePersistenceTarget();
      await reportPracticeSessionEvent(selectedActivePracticeSession.id, {
        eventType: 'session.ended',
        payload: {
          reason: 'manual_disconnect',
          status: 'completed',
          chatId: selectedActivePracticeSession.chatId,
        },
      });
      clearMessages();
      disconnect();
      await loadWorkspace(selectedActivePracticeSession.chatId || null);
      setReviewSessionId(endedId);
    } catch (endError) {
      dispatch({
        type: 'patch',
        payload: { error: endError instanceof Error ? endError.message : 'Failed to end this practice session.' },
      });
    } finally {
      dispatch({ type: 'patch', payload: { isMutating: false } });
    }
  };

  const handleSendText = async () => {
    if (!bootstrap || !selectedChatId || !textInput.trim() || isSendingText || isMutating) {
      return;
    }
    if (bootstrap.launch.modality.mode !== 'text_only') {
      dispatch({ type: 'patch', payload: { error: 'Text practice is not enabled for this assignment launch.' } });
      return;
    }

    const message = textInput.trim();
    dispatch({ type: 'patch', payload: { isSendingText: true, error: null, textInput: '' } });

    try {
      const practiceSession = await ensureActivePracticeSessionForSelectedThread();
      if (!practiceSession) return;
      if (!practiceSession.textEnabled) {
        dispatch({ type: 'patch', payload: { error: 'Text practice is not enabled for this assignment attempt.' } });
        return;
      }
      const userTurnIndex = nextMessageOrderRef.current;
      const assistantTurnIndex = userTurnIndex + 1;
      nextMessageOrderRef.current += 2;
      const coachNote = pendingPromoteBackRef.current;
      pendingPromoteBackRef.current = null;
      const response = await sendChatMessage(selectedChatId, message, {
        assignmentId: bootstrap.assignment.id,
        practiceSessionId: practiceSession.id,
        uiLanguage: lang,
        ...(coachNote ? { coachNote } : {}),
      });
      dispatch({
        type: 'appendHistoryMessages',
        messages: [
          {
            id: `${selectedChatId}-user-${userTurnIndex}`,
            role: 'user',
            content: message,
            timestamp: new Date().toISOString(),
          },
          {
            id: `${selectedChatId}-assistant-${assistantTurnIndex}`,
            role: 'assistant',
            content: response.response,
            timestamp: new Date().toISOString(),
          },
        ],
      });
      await queuePracticeEvent(practiceSession.id, 'student.turn', userTurnIndex, {
        chatId: selectedChatId,
        content: message,
        source: 'text',
      });
      await queuePracticeEvent(practiceSession.id, 'assistant.turn', assistantTurnIndex, {
        chatId: selectedChatId,
        content: response.response,
        source: 'text',
      });
      void triggerCoachChip(userTurnIndex);
    } catch (sendError) {
      dispatch({
        type: 'patch',
        payload: { error: sendError instanceof Error ? sendError.message : 'Failed to send assignment message.' },
      });
    } finally {
      dispatch({ type: 'patch', payload: { isSendingText: false } });
    }
  };

  const handleClose = () => {
    closeWithoutAbandonRef.current = true;
    clearRealtimePersistenceTarget();
    clearMessages();
    disconnect();
    onClose();
  };

  useEffect(() => {
    return () => {
      const practiceSession = getActivePracticeSession();
      clearRealtimePersistenceTarget();
      if (!practiceSession || shouldCloseWithoutAbandon()) {
        disconnect();
        return;
      }

      void reportPracticeSessionEvent(practiceSession.id, {
        eventType: 'session.ended',
        payload: {
          reason: 'page_leave',
          status: 'abandoned',
          chatId: getSelectedChatId(),
        },
      });
      disconnect();
    };
  }, [disconnect, getActivePracticeSession, getSelectedChatId, shouldCloseWithoutAbandon]);

  const displayMessages = useMemo(
    () => (open && selectedChatId ? [...historyMessages, ...realtimeMessages] : []),
    [historyMessages, open, realtimeMessages, selectedChatId],
  );
  const isTextLaunch = bootstrap?.launch.modality.mode === 'text_only';
  const canUseVoice = Boolean(selectedThread && (selectedActivePracticeSession?.voiceEnabled || (!selectedActivePracticeSession && bootstrap?.launch.voiceAllowed)));
  const canUseText = Boolean(
    isTextLaunch &&
    selectedThread &&
    selectedChatId &&
    (selectedActivePracticeSession?.textEnabled || (!selectedActivePracticeSession && bootstrap?.launch.textAllowed)),
  );
  const voiceStatusLabel = isConnecting
    ? 'Connecting...'
    : isConnected
      ? isTutorHoldActive
        ? t('app.learn.status.tutorHold')
        : 'Voice connected'
      : 'Tap the mic to connect';
  const sidebarExpansion = useMemo(
    () => ({
      sidebar: isSidebarExpanded,
      scope: isScopeExpanded,
      history: isHistoryExpanded,
    }),
    [isHistoryExpanded, isScopeExpanded, isSidebarExpanded],
  );
  const conversationStatus = useMemo(
    () => ({
      isMutating,
      isConnecting,
      isConnected,
      isListening,
      isSpeaking,
    }),
    [isConnected, isConnecting, isListening, isMutating, isSpeaking],
  );
  const composerState = useMemo<AssignmentComposerState>(
    () => ({
      canUseVoice,
      canUseText,
      isConnecting,
      isMutating,
      isConnected,
      isTutorHoldActive,
      hasHeldTutorResponse,
      isSendingText,
      speakingSpeed,
      textInput,
      voiceStatusLabel,
    }),
    [
      canUseText,
      canUseVoice,
      hasHeldTutorResponse,
      isConnected,
      isConnecting,
      isMutating,
      isSendingText,
      isTutorHoldActive,
      speakingSpeed,
      textInput,
      voiceStatusLabel,
    ],
  );
  const holdLabels = useMemo(
    () => ({
      release: t('app.learn.chat.hold.release'),
      active: t('app.learn.chat.hold.active'),
      inactive: t('app.learn.chat.hold.inactive'),
    }),
    [t],
  );
  const handleToggleSidebar = useCallback(() => {
    dispatch({ type: 'toggleSidebar' });
  }, []);
  const handleToggleScope = useCallback(() => {
    dispatch({ type: 'toggleScope' });
  }, []);
  const handleToggleHistory = useCallback(() => {
    dispatch({ type: 'toggleHistory' });
  }, []);
  const handleSelectThread = useCallback((nextChatId: string) => {
    dispatch({ type: 'patch', payload: { selectedChatId: nextChatId } });
  }, []);
  const handleOpenScope = useCallback(() => {
    dispatch({ type: 'patch', payload: { isSidebarExpanded: true, isScopeExpanded: true } });
  }, []);
  const handleOpenHistory = useCallback(() => {
    dispatch({ type: 'patch', payload: { isSidebarExpanded: true, isHistoryExpanded: true } });
  }, []);
  const handleTextChange = useCallback((nextText: string) => {
    dispatch({ type: 'patch', payload: { textInput: nextText } });
  }, []);

  const canReview = !!reviewSessionId && !isConnected;

  return {
    lang,
    workspace,
    selectedChatId,
    selectedThread,
    selectedActivePracticeSession,
    loading,
    loadingChat,
    error,
    reviewSessionId,
    canReview,
    coachChips,
    lastLearnerTurnIndexRef,
    displayMessages,
    sidebarExpansion,
    conversationStatus,
    composerState,
    holdLabels,
    handleClose,
    handleToggleSidebar,
    handleToggleScope,
    handleToggleHistory,
    handleOpenScope,
    handleOpenHistory,
    handleSelectThread,
    handleNewAttempt,
    handleEndSession,
    handleSpeakingSpeedChange,
    setTutorHoldActive,
    handleVoiceToggle,
    handleTextChange,
    handleSendText,
  };
}

export function AssignmentPracticeWorkspace(props: AssignmentPracticeWorkspaceProps) {
  const { open, bootstrap } = props;
  const controller = useAssignmentPracticeWorkspaceController(props);
  const {
    lang,
    workspace,
    selectedChatId,
    selectedThread,
    selectedActivePracticeSession,
    loading,
    loadingChat,
    error,
    reviewSessionId,
    canReview,
    coachChips,
    lastLearnerTurnIndexRef,
    displayMessages,
    sidebarExpansion,
    conversationStatus,
    composerState,
    holdLabels,
    handleClose,
    handleToggleSidebar,
    handleToggleScope,
    handleToggleHistory,
    handleOpenScope,
    handleOpenHistory,
    handleSelectThread,
    handleNewAttempt,
    handleEndSession,
    handleSpeakingSpeedChange,
    setTutorHoldActive,
    handleVoiceToggle,
    handleTextChange,
    handleSendText,
  } = controller;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!nextOpen) handleClose();
    }}>
      <DialogContent className="grid h-[calc(100dvh-1rem)] max-h-[920px] w-[calc(100vw-1rem)] max-w-[1500px] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden border-3 border-foreground bg-background p-0 shadow-stamp sm:h-[calc(100dvh-2rem)] sm:w-[calc(100vw-2rem)]">
        <DialogHeader className="border-b-2 border-border bg-card px-4 py-4 pr-12 sm:px-6">
          <DialogTitle className="font-display text-2xl">
            {bootstrap?.assignment.title || 'Assignment practice'}
          </DialogTitle>
          <DialogDescription>
            Assignment-scoped conversation workspace with history and teacher guidance.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex min-h-[420px] items-center justify-center">
            <Loader2 className="size-8 animate-spin text-primary" />
          </div>
        ) : error ? (
          <div className="p-6">
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </div>
        ) : bootstrap && workspace ? (
          <div className="flex min-h-0 overflow-hidden bg-background max-lg:flex-col">
            <AssignmentWorkspaceSidebar
              bootstrap={bootstrap}
              workspace={workspace}
              lang={lang}
              selectedChatId={selectedChatId}
              expansion={sidebarExpansion}
              onToggleSidebar={handleToggleSidebar}
              onToggleScope={handleToggleScope}
              onToggleHistory={handleToggleHistory}
              onOpenScope={handleOpenScope}
              onOpenHistory={handleOpenHistory}
              onSelectThread={handleSelectThread}
              onNewAttempt={() => void handleNewAttempt()}
            />
            <AssignmentConversationView
              selectedThread={selectedThread}
              selectedActivePracticeSession={selectedActivePracticeSession}
              selectedChatId={selectedChatId}
              messages={displayMessages}
              loadingChat={loadingChat}
              reviewSessionId={reviewSessionId}
              canReview={canReview}
              coachChips={coachChips}
              askModeEnabled={bootstrap?.launch.askModeEnabled ?? false}
              currentTurnIndex={lastLearnerTurnIndexRef.current}
              status={conversationStatus}
              composerState={composerState}
              holdLabels={holdLabels}
              onEndSession={() => void handleEndSession()}
              onSpeakingSpeedChange={handleSpeakingSpeedChange}
              onTutorHoldChange={setTutorHoldActive}
              onVoiceToggle={() => void handleVoiceToggle()}
              onTextChange={handleTextChange}
              onSendText={() => void handleSendText()}
            />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
