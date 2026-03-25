import { useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, Play } from 'lucide-react';
import { Button } from '@/components/ui';
import type { CanvasCourseContentItem } from '@/types/canvas';

interface Props {
  items: CanvasCourseContentItem[];
  canvasInstanceUrl?: string;
  /** Map of canvasItemId → Lingual assignmentId for linked items. */
  linkedAssignments?: Record<string, string>;
  onLaunchAssignment?: (assignmentId: string) => void;
}

interface ModuleGroup {
  moduleId: string;
  moduleName: string;
  position: number;
  items: CanvasCourseContentItem[];
}

export function CanvasModuleView({
  items,
  canvasInstanceUrl,
  linkedAssignments = {},
  onLaunchAssignment,
}: Props) {
  const modules = groupByModule(items);
  const [expandedModules, setExpandedModules] = useState<Set<string>>(
    new Set(modules.map((m) => m.moduleId)),
  );

  const toggleModule = (moduleId: string) => {
    setExpandedModules((prev) => {
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
        const isExpanded = expandedModules.has(mod.moduleId);
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
                {mod.items
                  .sort((a, b) => a.itemPosition - b.itemPosition)
                  .map((item) => {
                    const assignmentId = linkedAssignments[item.canvasItemId];
                    return (
                      <li
                        key={item.canvasItemId}
                        className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0"
                      >
                        <span className="flex-1 text-sm">{item.title}</span>
                        <span className="text-xs text-muted-foreground">{item.itemType}</span>
                        {assignmentId && onLaunchAssignment ? (
                          <Button
                            size="sm"
                            onClick={() => onLaunchAssignment(assignmentId)}
                            data-testid={`launch-${item.canvasItemId}`}
                          >
                            <Play size={14} className="mr-1" />
                            Start Practice
                          </Button>
                        ) : canvasInstanceUrl ? (
                          <a
                            href={`${canvasInstanceUrl}/courses`}
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
  return Object.values(map).sort((a, b) => a.position - b.position);
}
