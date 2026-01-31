import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThreadTimelineCard } from '../ThreadTimelineCard';
import type { ThreadEmail, QuotationOffer } from '@/features/quotation/types';

const mockEmail = (id: string, subject: string): ThreadEmail => ({
  id,
  subject,
  from_address: 'test@example.com',
  sent_at: '2024-01-15T10:00:00Z',
  received_at: '2024-01-15T10:00:00Z',
  body_text: 'Test email body',
  extracted_data: null,
});

const defaultProps = {
  selectedEmailId: null,
  quotationOffers: [] as QuotationOffer[],
  expanded: false,
  onExpandedChange: vi.fn(),
  onSelectEmail: vi.fn(),
  formatDate: () => '15 Jan 2024',
};

describe('ThreadTimelineCard', () => {
  it('returns null when threadEmails has 1 or fewer items', () => {
    const { container } = render(
      <ThreadTimelineCard
        {...defaultProps}
        threadEmails={[mockEmail('1', 'Test')]}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders timeline when threadEmails has more than 1 item', () => {
    render(
      <ThreadTimelineCard
        {...defaultProps}
        threadEmails={[
          mockEmail('1', 'First email'),
          mockEmail('2', 'Second email'),
        ]}
      />
    );
    expect(screen.getByText(/Historique du fil/)).toBeInTheDocument();
    expect(screen.getByText(/2/)).toBeInTheDocument();
    expect(screen.getByText(/échanges/)).toBeInTheDocument();
  });

  it('calls onExpandedChange when toggle is clicked', async () => {
    const onExpandedChange = vi.fn();
    const user = userEvent.setup();
    
    render(
      <ThreadTimelineCard
        {...defaultProps}
        threadEmails={[
          mockEmail('1', 'First'),
          mockEmail('2', 'Second'),
        ]}
        onExpandedChange={onExpandedChange}
      />
    );
    
    await user.click(screen.getByRole('button', { name: /Afficher l'historique/i }));
    expect(onExpandedChange).toHaveBeenCalledWith(true);
  });

  it('calls onSelectEmail when an email item is clicked', async () => {
    const onSelectEmail = vi.fn();
    const user = userEvent.setup();
    const emails = [
      mockEmail('1', 'First email'),
      mockEmail('2', 'Second email'),
    ];
    
    render(
      <ThreadTimelineCard
        {...defaultProps}
        threadEmails={emails}
        expanded={true}
        onSelectEmail={onSelectEmail}
      />
    );
    
    await user.click(screen.getByText('Second email'));
    expect(onSelectEmail).toHaveBeenCalledWith(emails[1]);
  });

  it('supports keyboard navigation with Enter and Space', async () => {
    const onExpandedChange = vi.fn();
    const user = userEvent.setup();
    
    render(
      <ThreadTimelineCard
        {...defaultProps}
        threadEmails={[
          mockEmail('1', 'First'),
          mockEmail('2', 'Second'),
        ]}
        onExpandedChange={onExpandedChange}
      />
    );
    
    const trigger = screen.getByRole('button', { name: /Afficher l'historique/i });
    trigger.focus();
    
    await user.keyboard('{Enter}');
    expect(onExpandedChange).toHaveBeenCalled();
  });
});
