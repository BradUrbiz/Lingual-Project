import { render, screen, fireEvent } from '@testing-library/react';
import { CanvasModuleView } from './CanvasModuleView';
import type { CanvasCourseContentItem } from '@/types/canvas';

const ITEMS: CanvasCourseContentItem[] = [
  {
    id: 'c1', connectionId: 'conn1', classId: 'class-1',
    canvasModuleId: 'm1', canvasModuleName: 'Week 1', canvasModulePosition: 1,
    canvasItemId: 'i100', title: 'Reading', itemType: 'Page', itemPosition: 1,
  },
  {
    id: 'c2', connectionId: 'conn1', classId: 'class-1',
    canvasModuleId: 'm1', canvasModuleName: 'Week 1', canvasModulePosition: 1,
    canvasItemId: 'i101', title: 'Speaking Practice', itemType: 'Assignment', itemPosition: 2,
  },
  {
    id: 'c3', connectionId: 'conn1', classId: 'class-1',
    canvasModuleId: 'm2', canvasModuleName: 'Week 2', canvasModulePosition: 2,
    canvasItemId: 'i200', title: 'Essay', itemType: 'Assignment', itemPosition: 1,
  },
];

describe('CanvasModuleView', () => {
  it('renders modules in Canvas order', () => {
    render(<CanvasModuleView items={ITEMS} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons[0]).toHaveTextContent('Week 1');
    expect(buttons[1]).toHaveTextContent('Week 2');
  });

  it('renders items within expanded modules', () => {
    render(<CanvasModuleView items={ITEMS} />);
    expect(screen.getByText('Reading')).toBeInTheDocument();
    expect(screen.getByText('Speaking Practice')).toBeInTheDocument();
    expect(screen.getByText('Essay')).toBeInTheDocument();
  });

  it('collapses a module on click', () => {
    render(<CanvasModuleView items={ITEMS} />);
    // Click Week 1 header to collapse
    fireEvent.click(screen.getByText('Week 1'));
    // Reading should disappear
    expect(screen.queryByText('Reading')).not.toBeInTheDocument();
    // Week 2 items should still be visible
    expect(screen.getByText('Essay')).toBeInTheDocument();
  });

  it('shows "Start Practice" for linked items', () => {
    const onLaunch = vi.fn();
    render(
      <CanvasModuleView
        items={ITEMS}
        linkedAssignments={{ i101: 'assign-1' }}
        onLaunchAssignment={onLaunch}
      />,
    );
    expect(screen.getByTestId('launch-i101')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('launch-i101'));
    expect(onLaunch).toHaveBeenCalledWith('assign-1');
  });

  it('shows "Open in Canvas" for non-linked items with canvasInstanceUrl', () => {
    render(
      <CanvasModuleView
        items={ITEMS}
        canvasInstanceUrl="https://school.instructure.com"
      />,
    );
    expect(screen.getByTestId('open-canvas-i100')).toBeInTheDocument();
    expect(screen.getByTestId('open-canvas-i100')).toHaveAttribute(
      'href',
      expect.stringContaining('school.instructure.com'),
    );
  });

  it('returns null when no items', () => {
    const { container } = render(<CanvasModuleView items={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
