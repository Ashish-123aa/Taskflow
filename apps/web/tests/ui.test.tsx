import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  Button, ConfirmDialog, EmptyState, ErrorState, LoadingState, PriorityLabel, StatusBadge,
} from '../src/components/ui';
import { JOB_PRIORITIES, JOB_STATUSES, STATUS_LABELS } from '../src/lib/constants';

describe('StatusBadge', () => {
  it.each(JOB_STATUSES)('renders the human-readable label for %s', (status) => {
    render(<StatusBadge status={status} />);
    expect(screen.getByText(STATUS_LABELS[status])).toBeInTheDocument();
  });
});

describe('PriorityLabel', () => {
  it.each(JOB_PRIORITIES)('renders %s', (priority) => {
    render(<PriorityLabel priority={priority} />);
    expect(screen.getByText(priority)).toBeInTheDocument();
  });
});

describe('Button', () => {
  it('calls onClick when clicked', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not call onClick when disabled', async () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Save</Button>);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('is disabled and shows a spinner while loading, so a double-click cannot double-submit', async () => {
    const onClick = vi.fn();
    const { container } = render(<Button isLoading onClick={onClick}>Save</Button>);

    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toBeDisabled();
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();

    await userEvent.setup().click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('shows no spinner when not loading', () => {
    const { container } = render(<Button>Save</Button>);
    expect(container.querySelector('.animate-spin')).not.toBeInTheDocument();
  });
});

describe('ConfirmDialog', () => {
  const baseProps = {
    title: 'Delete this job?',
    description: 'It will be permanently removed.',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };

  it('renders nothing while closed', () => {
    render(<ConfirmDialog {...baseProps} open={false} />);
    expect(screen.queryByText('Delete this job?')).not.toBeInTheDocument();
  });

  it('renders the title, description, and default confirm label when open', () => {
    render(<ConfirmDialog {...baseProps} open />);
    expect(screen.getByText('Delete this job?')).toBeInTheDocument();
    expect(screen.getByText('It will be permanently removed.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
  });

  it('uses a custom confirm label', () => {
    render(<ConfirmDialog {...baseProps} open confirmLabel="Delete" />);
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('calls onConfirm — and only onConfirm — when confirmed', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog {...baseProps} open onConfirm={onConfirm} onCancel={onCancel} />);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('calls onCancel — and only onCancel — when cancelled', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog {...baseProps} open onConfirm={onConfirm} onCancel={onCancel} />);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('disables both buttons while the confirmed action is in flight', () => {
    render(<ConfirmDialog {...baseProps} open isLoading />);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  });
});

describe('ErrorState', () => {
  it('shows the error message', () => {
    render(<ErrorState message="Could not load jobs." />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('Could not load jobs.')).toBeInTheDocument();
  });

  it('has no retry button unless a retry handler is provided', () => {
    render(<ErrorState message="Nope" />);
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('calls the retry handler when "Try again" is clicked', async () => {
    const onRetry = vi.fn();
    render(<ErrorState message="Nope" onRetry={onRetry} />);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('EmptyState', () => {
  it('renders the title alone', () => {
    render(<EmptyState title="No jobs found" />);
    expect(screen.getByText('No jobs found')).toBeInTheDocument();
  });

  it('renders an optional description and action', () => {
    render(
      <EmptyState title="No jobs found" description="Create one to get started." action={<button type="button">Create</button>} />,
    );
    expect(screen.getByText('Create one to get started.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument();
  });
});

describe('LoadingState', () => {
  it('shows a default label', () => {
    render(<LoadingState />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('shows a custom label', () => {
    render(<LoadingState label="Checking your session…" />);
    expect(screen.getByText('Checking your session…')).toBeInTheDocument();
  });
});
