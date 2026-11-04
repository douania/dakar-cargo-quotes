import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResponseGuidanceDialog } from '../ResponseGuidanceDialog';
afterEach(cleanup);
const instructions = () => screen.getByRole('textbox');

it('keeps all guidance, expert and options open on refusal, with one request and no automatic retry', async () => {
  const generate = vi.fn().mockRejectedValue(new Error('La vérification de la zone est indisponible'));
  const close = vi.fn();
  render(<ResponseGuidanceDialog open onOpenChange={close} onGenerate={generate} emailSubject="Synthétique A" />);
  await userEvent.type(instructions(), 'Instruction opérateur conservée');
  await userEvent.click(screen.getByLabelText('Inclure détail des calculs'));
  await userEvent.click(screen.getByLabelText(/Cherif Sokhna/));
  await userEvent.click(screen.getByRole('button', { name: 'Générer avec instructions' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('zone');
  expect(screen.getByRole('alert')).toHaveTextContent('Aucun nouveau brouillon confirmé');
  expect(instructions()).toHaveValue('Instruction opérateur conservée');
  expect(screen.getByLabelText('Inclure détail des calculs')).toBeChecked();
  expect(screen.getByLabelText(/Cherif Sokhna/)).toBeChecked();
  expect(generate).toHaveBeenCalledOnce();
  expect(close).not.toHaveBeenCalled();
});

it('prevents rapid duplicate clicks and editing guidance while a generation is pending', async () => {
  let settle!: () => void;
  const generate = vi.fn(() => new Promise<void>(resolve => { settle = resolve; }));
  const close = vi.fn();
  render(<ResponseGuidanceDialog open onOpenChange={close} onGenerate={generate} />);
  await userEvent.type(instructions(), 'Test pending');
  const button = screen.getByRole('button', { name: 'Générer avec instructions' });
  fireEvent.click(button); fireEvent.click(button);
  expect(generate).toHaveBeenCalledOnce();
  expect(instructions()).toBeDisabled();
  expect(screen.getByLabelText('Inclure détail des calculs')).toBeDisabled();
  await act(async () => settle());
  expect(close).toHaveBeenCalledWith(false);
});

it.each(['resolve', 'reject'] as const)('ignores a late %s from an unmounted email dialog', async outcome => {
  let resolve!: () => void, reject!: (reason: Error) => void;
  const generate = vi.fn(() => new Promise<void>((ok, no) => { resolve = ok; reject = no; }));
  const close = vi.fn();
  const view = render(<ResponseGuidanceDialog key="A" open onOpenChange={close} onGenerate={generate} emailSubject="Même sujet" />);
  await userEvent.type(instructions(), 'Consignes A');
  await userEvent.click(screen.getByRole('button', { name: 'Générer avec instructions' }));
  view.rerender(<ResponseGuidanceDialog key="B" open onOpenChange={close} onGenerate={vi.fn()} emailSubject="Même sujet" />);
  await userEvent.type(instructions(), 'Consignes B');
  await act(async () => outcome === 'resolve' ? resolve() : reject(new Error('Refus tardif A')));
  expect(instructions()).toHaveValue('Consignes B');
  expect(close).not.toHaveBeenCalled();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('resets only after confirmation and keeps a failed draft through closing/reopening the same component', async () => {
  const generate = vi.fn().mockRejectedValueOnce(new Error('Refus')).mockResolvedValueOnce(undefined);
  const close = vi.fn();
  const view = render(<ResponseGuidanceDialog open onOpenChange={close} onGenerate={generate} />);
  await userEvent.type(instructions(), 'Conserver puis confirmer');
  await userEvent.click(screen.getByRole('button', { name: 'Générer avec instructions' }));
  await screen.findByRole('alert');
  view.rerender(<ResponseGuidanceDialog open={false} onOpenChange={close} onGenerate={generate} />);
  view.rerender(<ResponseGuidanceDialog open onOpenChange={close} onGenerate={generate} />);
  expect(instructions()).toHaveValue('Conserver puis confirmer');
  await userEvent.click(screen.getByRole('button', { name: 'Générer avec instructions' }));
  expect(close).toHaveBeenCalledWith(false);
  expect(instructions()).toHaveValue('');
  expect(generate).toHaveBeenCalledTimes(2);
});
