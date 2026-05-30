import { useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, Play, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui';
import type { CanvasCourseContentItem } from '@/types/canvas';

interface Props {
  items: CanvasCourseContentItem[];
  canvasInstanceUrl?: string;
  /** Map of canvasItemId → Lingual assignmentId for linked items. */
  linkedAssignments?: Record<string, string>;
  onLaunchAssignment?: (assignmentId: string) => void;
  /** When true, shows "Create Practice" buttons for unlinked items. */
  isTeacherView?: boolean;
  /** Called when teacher clicks "Create Practice" on an item. */
  onCreatePractice?: (item: CanvasCourseContentItem) => void;
}

interface ModuleGroup {
  moduleId: string;
  moduleName: string;
  position: number;
  items: CanvasCourseContentItem[];
}

const EMPTY_LINKED_ASSIGNMENTS: Record<string, string> = {};

export function CanvasModuleView({
  items,
  linkedAssignments = EMPTY_LINKED_ASSIGNMENTS,
  onLaunchAssignment,
  isTeacherView = false,
  onCreatePractice,
}: Props) {
  const modules = groupByModule(items);
  // Track collapsed modules so synced content is visible by default.
  const [collapsedModules, setCollapsedModules] = useState<Set<string>>(new Set());

  const toggleModule = (moduleId: string) => {
    setCollapsedModules((prev) => {
      const next = new Set(prev);
      if (next.has(moduleId)) next.delete(moduleId);
      else next.add(moduleId);
      return next;
    });
  };

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3" data-testid="canvas-module-view">
      {modules.map((mod) => {
        const isExpanded = !collapsedModules.has(mod.moduleId);
        return (
          <div key={mod.moduleId} className="rounded-xl border-2 border-border">
            <button
              type="button"
              className="flex w-full items-center gap-2 p-3 text-left text-sm font-bold"
              onClick={() => toggleModule(mod.moduleId)}
              aria-expanded={isExpanded}
            >
              {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              {mod.moduleName}
              <span className="ml-auto text-xs font-normal text-muted-foreground">
                {mod.items.length} item{mod.items.length !== 1 ? 's' : ''}
              </span>
            </button>
            {isExpanded && (
              <ul className="border-t border-border">
                {Array.from(mod.items)
                  .sort((a, b) => a.itemPosition - b.itemPosition)
                  .map((item) => {
                    const assignmentId = linkedAssignments[item.canvasItemId];
                    return (
                      <li
                        key={item.canvasItemId}
                        className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0"
                      >
                        <div className="min-w-0 flex-1">
                          {item.htmlUrl ? (
                            <a
                              href={item.htmlUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm font-medium text-foreground hover:text-primary hover:underline"
                            >
                              {item.title}
                            </a>
                          ) : (
                            <span className="text-sm">{item.title}</span>
                          )}
                          {(item.dueAt || item.pointsPossible != null) && (
                            <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                              {item.dueAt && <span>{formatDueDate(item.dueAt)}</span>}
                              {item.pointsPossible != null && <span>{item.pointsPossible} pts</span>}
                            </div>
                          )}
                        </div>
                        <span className="shrink-0 text-xs text-muted-foreground">{item.itemType}</span>
                        {assignmentId && onLaunchAssignment ? (
                          <Button
                            size="sm"
                            onClick={() => onLaunchAssignment(assignmentId)}
                            data-testid={`launch-${item.canvasItemId}`}
                          >
                            <Play size={14} className="mr-1" />
                            Start Practice
                          </Button>
                        ) : isTeacherView && !assignmentId && onCreatePractice ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onCreatePractice(item)}
                            data-testid={`create-practice-${item.canvasItemId}`}
                          >
                            <Sparkles size={14} className="mr-1" />
                            Create Practice
                          </Button>
                        ) : item.htmlUrl ? (
                          <a
                            href={item.htmlUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                            data-testid={`open-canvas-${item.canvasItemId}`}
                          >
                            Open in Canvas
                            <ExternalLink size={12} />
                          </a>
                        ) : null}
                      </li>
                    );
                  })}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

function formatDueDate(isoDate: string): string {
  try {
    const date = new Date(isoDate);
    return date.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
  } catch {
    return '';
  }
}

function groupByModule(items: CanvasCourseContentItem[]): ModuleGroup[] {
  const map: Record<string, ModuleGroup> = {};
  for (const item of items) {
    if (!map[item.canvasModuleId]) {
      map[item.canvasModuleId] = {
        moduleId: item.canvasModuleId,
        moduleName: item.canvasModuleName,
        position: item.canvasModulePosition,
        items: [],
      };
    }
    map[item.canvasModuleId].items.push(item);
  }
  // Sort ascending so Canvas module position 1 renders before position 2,
  // matching the order students see in Canvas itself.
  return Array.from(Object.values(map)).sort((a, b) => a.position - b.position);
}
