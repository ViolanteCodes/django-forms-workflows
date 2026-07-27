import { describe, expect, it } from 'vitest';
import { apiMethods } from '../../django_forms_workflows/static/django_forms_workflows/js/form-builder-api.js';

describe('apiMethods.updateFieldIdCounterFromFields', () => {
  it('seeds the counter one past the highest existing numeric suffix', () => {
    const ctx = { fieldIdCounter: 1 };
    const fields = [{ field_name: 'text_1' }, { field_name: 'email_3' }, { field_name: 'date_2' }];

    apiMethods.updateFieldIdCounterFromFields.call(ctx, fields);

    expect(ctx.fieldIdCounter).toBe(4);
  });

  it('defaults to 1 when there are no fields yet', () => {
    const ctx = { fieldIdCounter: 99 };

    apiMethods.updateFieldIdCounterFromFields.call(ctx, []);

    expect(ctx.fieldIdCounter).toBe(1);
  });

  it('ignores field names that do not end in a number', () => {
    const ctx = { fieldIdCounter: 1 };
    const fields = [{ field_name: 'customer_email' }, { field_name: 'text_5' }];

    apiMethods.updateFieldIdCounterFromFields.call(ctx, fields);

    expect(ctx.fieldIdCounter).toBe(6);
  });

  it('does not crash on a field with no field_name', () => {
    const ctx = { fieldIdCounter: 1 };
    const fields = [{}, { field_name: 'text_2' }];

    apiMethods.updateFieldIdCounterFromFields.call(ctx, fields);

    expect(ctx.fieldIdCounter).toBe(3);
  });
});
