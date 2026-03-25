import { useState } from 'react';
import { Button } from '@/components/ui';
import type { CanvasCourseContentItem } from '@/types/canvas';

interface Props {
  items: CanvasCourseContentItem[];
  linkedItemId: string | null;
  onLink: (item: CanvasCourseContentItem) => void;
  onUnlink: () => void;
}

export function CanvasLinkPicker({ items, linkedItemId, onLink, onUnlink }: Props) {
  const [selectedId, setSelectedId] = useState(linkedItemId || '');

  // Group items by module
  const modules = items.reduce<Record<string, { name: string; position: number; items: CanvasCourseContentItem[] }>>(
    (acc, item) => {
      const key = item.canvasModuleId;
      if (!acc[key]) {
        acc[key] = { name: item.canvasModuleName, position: item.canvasModulePosition, items: [] };
      }
      acc[key].items.push(item);
      return acc;
    },
    {},
  );

  const sortedModules = Object.values(modules).sort((a, b) => a.position - b.position);

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">No Canvas course content synced yet.</p>;
  }

  const linked = linkedItemId ? items.find((i) => i.canvasItemId === linkedItemId) : null;

  if (linked) {
    return (
      <div className="flex items-center gap-2 rounded-md border p-2 text-sm" data-testid="canvas-linked-item">
        <span className="flex-1">
          Linked to: <strong>{linked.title}</strong>
          <span className="ml-1 text-xs text-muted-foreground">({linked.canvasModuleName})</span>
        </span>
        <Button variant="outline" size="sm" onClick={onUnlink}>
          Unlink
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="canvas-link-picker">
      <select
        value={selectedId}
        onChange={(e) => setSelectedId(e.target.value)}
        className="w-full rounded-md border px-3 py-2 text-sm"
        aria-label="Select Canvas item to link"
      >
        <option value="">Select a Canvas item...</option>
        {sortedModules.map((mod) => (
          <optgroup key={mod.name} label={mod.name}>
            {mod.items
              .sort((a, b) => a.itemPosition - b.itemPosition)
              .map((item) => (
                <option key={item.canvasItemId} value={item.canvasItemId}>
                  {item.title} ({item.itemType})
                </option>
              ))}
          </optgroup>
        ))}
      </select>
      <Button
        variant="outline"
        size="sm"
        disabled={!selectedId}
        onClick={() => {
          const item = items.find((i) => i.canvasItemId === selectedId);
          if (item) onLink(item);
        }}
      >
        Link to Canvas item
      </Button>
    </div>
  );
}
