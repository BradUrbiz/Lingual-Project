import { CheckCircle2, Play, Plus, History, Trash2 } from 'lucide-react';
import { clsx } from 'clsx';
import type { ChatSession } from '@/types';

const formatShortDate = (value?: string) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

function SessionItem({
  session,
  isActive,
  onSelect,
  onDelete,
  t,
}: {
  session: ChatSession;
  isActive: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string, e: React.MouseEvent) => void;
  t: (key: string) => string;
}) {
  const hasMessages = session.message_count > 0;
  const lastMessage = session.last_message || t('app.learn.sessions.noMessages');

  return (
    <div
      onClick={() => onSelect(session.id)}
      className={clsx(
        'w-full text-left relative flex items-center p-4 rounded-xl border-2 transition-all mb-4 cursor-pointer group',
        isActive
          ? 'bg-card border-foreground shadow-stamp'
          : 'bg-card border-border hover:border-foreground hover:shadow-stamp-sm'
      )}
    >
      <div
        className={clsx(
          'w-10 h-10 rounded-xl flex items-center justify-center mr-4 z-10 border-2',
          hasMessages ? 'bg-primary text-primary-foreground border-foreground' : 'bg-secondary text-muted-foreground border-border'
        )}
      >
        {hasMessages ? <CheckCircle2 size={20} /> : <Play size={18} fill="currentColor" />}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-3">
          <h4 className="font-display font-bold text-sm text-foreground truncate">
            {session.title || t('app.learn.sessions.newChatTitle')}
          </h4>
          <span className="text-xs text-muted-foreground">{formatShortDate(session.updated_at)}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1 truncate">{lastMessage}</p>
      </div>

      {hasMessages && (
        <div className="ml-3 text-xs font-bold text-primary bg-primary/10 px-2.5 py-1 rounded-lg border border-primary/20">
          {session.message_count}
        </div>
      )}

      <button
        onClick={(e) => onDelete(session.id, e)}
        className="absolute right-2 top-2 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive hover:bg-destructive/10"
        title={t('chat.deleteConfirm') || 'Delete chat'}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

interface ChatSessionsSidebarProps {
  sessions: ChatSession[];
  currentChatId: string | null;
  mostRecentSession: ChatSession | undefined;
  showResume: boolean;
  loading: boolean;
  onSelectSession: (id: string) => void;
  onCreateNew: () => void;
  onDelete: (id: string, e: React.MouseEvent) => void;
  t: (key: string) => string;
}

export function ChatSessionsSidebar({
  sessions,
  currentChatId,
  mostRecentSession,
  showResume,
  loading,
  onSelectSession,
  onCreateNew,
  onDelete,
  t,
}: ChatSessionsSidebarProps) {
  return (
    <div className="flex-1 min-h-0 bg-card rounded-2xl border-3 border-foreground shadow-stamp overflow-hidden flex flex-col">
      <div className="p-6 border-b-3 border-foreground bg-secondary flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-display font-bold text-foreground">
            {t('app.learn.sessions.title')}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            {t('app.learn.sessions.subtitle')}
          </p>
        </div>
        <button
          onClick={onCreateNew}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-primary bg-card border-2 border-primary hover:bg-primary/5 transition-colors"
        >
          <Plus size={16} strokeWidth={2.5} />
          {t('app.learn.sessions.new')}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {showResume && mostRecentSession ? (
          <button
            onClick={() => onSelectSession(mostRecentSession.id)}
            className="w-full mb-4 p-4 rounded-xl border-2 border-primary/30 bg-primary/5 text-left hover:bg-primary/10 hover:border-primary transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="w-10 h-10 rounded-xl bg-card text-primary flex items-center justify-center border-2 border-primary/30">
                <History size={18} strokeWidth={2.5} />
              </span>
              <div className="min-w-0">
                <p className="text-xs text-primary font-bold uppercase tracking-wider">
                  {t('app.learn.sessions.resume')}
                </p>
                <p className="text-sm font-display font-bold text-foreground truncate">
                  {mostRecentSession.title || t('app.learn.sessions.latest')}
                </p>
                {mostRecentSession.last_message ? (
                  <p className="text-xs text-muted-foreground truncate">{mostRecentSession.last_message}</p>
                ) : null}
              </div>
            </div>
          </button>
        ) : null}
        {loading ? (
          <div className="text-sm text-muted-foreground">{t('app.learn.sessions.loading')}</div>
        ) : sessions.length === 0 ? (
          <div className="text-sm text-muted-foreground">{t('app.learn.sessions.empty')}</div>
        ) : (
          sessions.map((session) => (
            <SessionItem
              key={session.id}
              session={session}
              isActive={session.id === currentChatId}
              onSelect={onSelectSession}
              onDelete={onDelete}
              t={t}
            />
          ))
        )}
      </div>
    </div>
  );
}
