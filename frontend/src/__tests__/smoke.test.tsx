import { render } from '@testing-library/react';

describe('smoke', () => {
  it('renders a simple element', () => {
    const { getByText } = render(<div>Hello test</div>);
    expect(getByText('Hello test')).toBeInTheDocument();
  });
});
