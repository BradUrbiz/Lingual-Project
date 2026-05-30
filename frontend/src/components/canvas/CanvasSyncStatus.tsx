import { useCallback, useEffect, useReducer } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCanvasStatus, syncCanvas, disconnectCanvas } from '@/api/canvas';
import type { CanvasConnectionStatus, CanvasSyncRosterResult } from '@/types/canvas';
import { Button } from '@/components/ui';

interface Props {
  classId: string;
}

type CanvasSyncState = {
  connectionStatus: CanvasConnectionStatus | null;
  syncing: boolean;
  error: string | null;
  lastRoster: CanvasSyncRosterResult | null;
};

type CanvasSyncAction =
  | { type: 'loaded'; connectionStatus: CanvasConnectionStatus }
  | { type: 'syncStarted' }
  | { type: 'syncCompleted'; lastRoster: CanvasSyncRosterResult | null }
  | { type: 'failed'; error: string }
  | { type: 'disconnected' };

const INITIAL_CANVAS_SYNC_STATE: CanvasSyncState = {
  connectionStatus: null,
  syncing: false,
  error: null,
  lastRoster: null,
};

function canvasSyncReducer(state: CanvasSyncState, action: CanvasSyncAction): CanvasSyncState {
  switch (action.type) {
    case 'loaded':
      return { ...state, connectionStatus: action.connectionStatus };
    case 'syncStarted':
      return { ...state, syncing: true, error: null };
    case 'syncCompleted':
      return { ...state, syncing: false, lastRoster: action.lastRoster };
    case 'failed':
      return { ...state, syncing: false, error: action.error };
    case 'disconnected':
      return { ...state, connectionStatus: { connected: false } };
    default:
      return state;
  }
}

export function CanvasSyncStatus({ classId }: Props) {
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(canvasSyncReducer, INITIAL_CANVAS_SYNC_STATE);
  const { connectionStatus, syncing, error, lastRoster } = state;

  const loadStatus = useCallback(async () => {
    try {
      const data = await getCanvasStatus(classId);
      dispatch({ type: 'loaded', connectionStatus: data });
    } catch {
      // Non-critical - just means status unavailable
    }
  }, [classId]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const handleSync = async () => {
    dispatch({ type: 'syncStarted' });
    try {
      const result = await syncCanvas(classId);
      dispatch({ type: 'syncCompleted', lastRoster: result.roster ?? null });
      await loadStatus();
    } catch (err) {
      dispatch({ type: 'failed', error: err instanceof Error ? err.message : 'Sync failed' });
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnectCanvas(classId);
      dispatch({ type: 'disconnected' });
    } catch (err) {
      dispatch({ type: 'failed', error: err instanceof Error ? err.message : 'Disconnect failed' });
    }
  };

  if (!connectionStatus) return null;

  if (!connectionStatus.connected) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => navigate(`/app/teacher/classes/${classId}/canvas/connect`)}
      >
        Connect Canvas
      </Button>
    );
  }

  const statusLabel =
    connectionStatus.syncStatus === 'completed'
      ? 'Synced'
      : connectionStatus.syncStatus === 'syncing'
        ? 'Syncing...'
        : connectionStatus.syncStatus === 'error'
          ? 'Sync error'
          : 'Never synced';

  return (
    <div className="flex flex-col gap-2" data-testid="canvas-sync-status">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">
          Canvas: {connectionStatus.canvasCourseName || connectionStatus.canvasCourseId}
        </span>
        <span
          className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
            connectionStatus.syncStatus === 'completed'
              ? 'bg-green-100 text-green-700'
              : connectionStatus.syncStatus === 'error'
                ? 'bg-red-100 text-red-700'
                : 'bg-gray-100 text-gray-600'
          }`}
        >
          {statusLabel}
        </span>
        <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
          {syncing ? 'Refreshing...' : 'Refresh Canvas roster'}
        </Button>
        <Button variant="outline" size="sm" onClick={handleDisconnect}>
          Disconnect
        </Button>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
      <p className="text-xs text-muted-foreground">
        Updates the Canvas roster list and refreshes course content. Does not add or remove
        students from your class - share your class code to enroll students.
      </p>
      {lastRoster && (
        <p className="text-xs text-muted-foreground" data-testid="canvas-roster-result">
          {lastRoster.entries_upserted} Canvas student
          {lastRoster.entries_upserted === 1 ? '' : 's'} captured
          {lastRoster.entries_removed > 0
            ? `, ${lastRoster.entries_removed} dropped from roster`
            : ''}
          .
        </p>
      )}
    </div>
  );
}
