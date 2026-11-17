import { fireEvent } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';

/**
 * A fresh QueryClient per test, with retries disabled — a component
 * under test that hits a mocked API error should show that error
 * immediately, not after React Query's default retry/backoff cycle.
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

/**
 * Submits the nearest ancestor <form> of `element` via a direct `submit`
 * event, instead of `userEvent.click()` on a submit button.
 *
 * This project's forms wrap each field in a <label> that nests its
 * <input> (see pages/AuthShell.tsx's Field component) — the standard,
 * correct way to associate a label with a control without a separate
 * htmlFor/id pair. Verified directly against this exact pattern: jsdom
 * does not reliably propagate a button click into a real form
 * submission when a <label> wrapping an <input> is present elsewhere in
 * the form (neither userEvent.click() nor a plain fireEvent.click() on
 * the submit button triggers react-hook-form's onSubmit, even though
 * the identical button click works fine in an otherwise-identical form
 * with no such label). Firing `submit` on the form directly sidesteps
 * that jsdom-specific gap — it still exercises the real `handleSubmit`
 * the same way any submission path would, since react-hook-form doesn't
 * distinguish *how* a submit was triggered.
 */
export function submitClosestForm(element: HTMLElement): void {
  const form = element.closest('form');
  if (!form) throw new Error('submitClosestForm: no ancestor <form> found');
  fireEvent.submit(form);
}
