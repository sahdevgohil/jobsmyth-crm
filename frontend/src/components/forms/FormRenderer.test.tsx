import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Answers, FormDefinition } from '@/lib/form-engine';
import { FormRenderer } from './FormRenderer';

const def: FormDefinition = {
  sections: [
    {
      id: 'job',
      title: 'Job details',
      fields: [
        { id: 'insurance_claim', label: 'Insurance claim?', type: 'yes_no', required: true },
        { id: 'carrier', label: 'Carrier', type: 'text', required: true, visibleWhen: { field: 'insurance_claim', op: 'eq', value: true } },
        { id: 'material', label: 'Material', type: 'dropdown', options: [{ value: 'asphalt', label: 'Asphalt' }, { value: 'metal', label: 'Metal' }] },
        { id: 'pitch_sections', label: 'Photos', type: 'photos', minPhotos: 2 },
      ],
    },
    { id: 'extra', title: 'Extras', fields: [{ id: 'notes', label: 'Notes', type: 'long_text' }] },
  ],
};

function Harness({ initial = {} }: { initial?: Answers }): React.ReactElement {
  const [a, setA] = useState<Answers>(initial);
  return <FormRenderer definition={def} answers={a} onChange={setA} photos={[]} onAddPhoto={() => undefined} onRemovePhoto={() => undefined} />;
}

afterEach(cleanup);

describe('FormRenderer', () => {
  it('shows a conditional field only when its condition holds, and drops its answer when hidden again', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.queryByLabelText(/Carrier/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Yes' }));
    const carrier = await screen.findByLabelText(/Carrier/);
    await user.type(carrier, 'Acme Mutual');
    await user.click(screen.getByRole('button', { name: 'No' }));
    expect(screen.queryByLabelText(/Carrier/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Yes' }));
    expect((await screen.findByLabelText(/Carrier/) as HTMLInputElement).value).toBe('');
  });

  it('reports progress, shows the photo requirement, and moves between sections', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.getByRole('progressbar', { name: 'Form progress' })).toBeTruthy();
    expect(screen.getByText(/0 added · 2 required/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Next section' }));
    expect(screen.getByRole('region', { name: 'Extras' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('region', { name: 'Job details' })).toBeTruthy();
  });

  it('is read-only when the form is completed', () => {
    render(<FormRenderer definition={def} answers={{ insurance_claim: false }} onChange={() => undefined} photos={[]} onAddPhoto={() => undefined} onRemovePhoto={() => undefined} readOnly />);
    expect((screen.getByRole('button', { name: 'No' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
