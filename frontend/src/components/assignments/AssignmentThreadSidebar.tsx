import { Badge, Button } from '@/components/ui';
import type { AssignmentWorkspaceThread } from '@/types';

interface AssignmentThreadSidebarProps {
  threads: AssignmentWorkspaceThread[];
  selectedChatId: string | null;
  onSelectThread: (chatId: string) => void;
  onNewAttempt?: () => void;
}

export function AssignmentThreadSidebar({
  threads,
  selectedChatId,
  onSelectThread,
  onNewAttempt,
}: AssignmentThreadSidebarProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Attempts</p>
          <p className="mt-1 text-sm text-foreground">Only this assignment.</p>
        </div>
        {onNewAttempt ? (
          <Button size="sm" onClick={onNewAttempt} className="shrink-0">
            New attempt
          </Button>
        ) : null}
      </div>

      <div className="max-h-[30vh] space-y-2 overflow-y-auto pr-1 lg:max-h-[42vh]">
        {threads.map((thread) => {
          const isSelected = thread.chatId === selectedChatId;
          return (
            <button
              key={thread.chatId}
              type="button"
              onClick={() => onSelectThread(thread.chatId)}
              className={`w-full rounded-2xl border-2 p-3 text-left transition-colors ${
                isSelected ? 'border-primary bg-primary/5' : 'border-border bg-background hover:bg-secondary/40'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-foreground">{thread.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {thread.messageCount} messages
                  </p>
                </div>
                <Badge variant={thread.hasActiveAttempt ? 'success' : 'outline'} size="sm">
                  {thread.hasActiveAttempt ? 'Active' : 'Past attempt'}
                </Badge>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
