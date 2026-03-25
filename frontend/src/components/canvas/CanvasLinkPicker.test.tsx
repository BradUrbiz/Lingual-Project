import { render, screen, fireEvent } from '@testing-library/react';
import { CanvasLinkPicker } from './CanvasLinkPicker';
import type { CanvasCourseContentItem } from '@/types/canvas';

const ITEMS: CanvasCourseContentItem[] = [
  {
    id: 'c1', connectionId: 'conn1', classId: 'class-1',
    canvasModuleId: 'm1', canvasModuleName: 'Week 1', canvasModulePosition: 1,
    canvasItemId: 'i100', title: 'Reading Assignment', itemType: 'Assignment', itemPosition: 1,
  },
  {
    id: 'c2', connectionId: 'conn1', classId: 'class-1',
    canvasModuleId: 'm1', canvasModuleName: 'Week 1', canvasModulePosition: 1,
    canvasItemId: 'i101', title: 'Quiz 1', itemType: 'Quiz', itemPosition: 2,
  },
  {
    id: 'c3', connectionId: 'conn1', classId: 'class-1',
    canvasModuleId: 'm2', canvasModuleName: 'Week 2', canvasModulePosition: 2,
    canvasItemId: 'i200', title: 'Essay', itemType: 'Assignment', itemPosition: 1,
  },
];

describe('CanvasLinkPicker', () => {
  it('renders module items grouped by module', () => {
    render(<CanvasLinkPicker items={ITEMS} linkedItemId={null} onLink={vi.fn()} onUnlink={vi.fn()} />);
    expect(screen.getByLabelText(/Select Canvas item/i)).toBeInTheDocument();
    expect(screen.getByText('Reading Assignment (Assignment)')).toBeInTheDocument();
    expect(screen.getByText('Quiz 1 (Quiz)')).toBeInTheDocument();
    expect(screen.getByText('Essay (Assignment)')).toBeInTheDocument();
  });

  it('shows linked item when linkedItemId is set', () => {
    render(<CanvasLinkPicker items={ITEMS} linkedItemId="i100" onLink={vi.fn()} onUnlink={vi.fn()} />);
    expect(screen.getByTestId('canvas-linked-item')).toBeInTheDocument();
    expect(screen.getByText(/Reading Assignment/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Unlink/i })).toBeInTheDocument();
  });

  it('calls onLink when selecting and clicking link button', () => {
    const onLink = vi.fn();
    render(<CanvasLinkPicker items={ITEMS} linkedItemId={null} onLink={onLink} onUnlink={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/Select Canvas item/i), { target: { value: 'i200' } });
    fireEvent.click(screen.getByRole('button', { name: /Link to Canvas item/i }));

    expect(onLink).toHaveBeenCalledWith(expect.objectContaining({ canvasItemId: 'i200', title: 'Essay' }));
  });

  it('calls onUnlink when clicking unlink', () => {
    const onUnlink = vi.fn();
    render(<CanvasLinkPicker items={ITEMS} linkedItemId="i100" onLink={vi.fn()} onUnlink={onUnlink} />);

    fireEvent.click(screen.getByRole('button', { name: /Unlink/i }));
    expect(onUnlink).toHaveBeenCalled();
  });

  it('shows empty message when no items', () => {
    render(<CanvasLinkPicker items={[]} linkedItemId={null} onLink={vi.fn()} onUnlink={vi.fn()} />);
    expect(screen.getByText(/No Canvas course content/i)).toBeInTheDocument();
  });
});
