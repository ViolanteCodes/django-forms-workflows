import { describe, expect, it } from 'vitest';
import { FormBuilder } from '../../django_forms_workflows/static/django_forms_workflows/js/form-builder.js';
import { fieldPropertyMethods } from '../../django_forms_workflows/static/django_forms_workflows/js/form-builder-field-properties.js';

// buildBasicPropertiesTab is called with `this` bound to a FormBuilder
// instance (it uses this.escapeHtml() and this.config.sharedOptionLists).
// Using the real prototype rather than stubbing escapeHtml keeps the escaping
// assertions below honest - it's the actual implementation under test too.
function createContext(config = {}) {
  const ctx = Object.create(FormBuilder.prototype);
  ctx.config = { sharedOptionLists: [], ...config };
  return ctx;
}

function render(field, ctx = createContext()) {
  const html = fieldPropertyMethods.buildBasicPropertiesTab.call(ctx, field, '', '');
  const container = document.createElement('div');
  container.innerHTML = html;
  return container;
}

function baseField(overrides = {}) {
  return {
    field_label: 'Label',
    field_name: 'field_1',
    field_type: 'text',
    required: false,
    help_text: '',
    show_help_text_in_detail: false,
    placeholder: '',
    choices: '',
    css_class: '',
    default_value: '',
    validation: {},
    ...overrides,
  };
}

describe('fieldPropertyMethods.buildBasicPropertiesTab', () => {
  it('escapes the field label instead of rendering it as raw HTML', () => {
    const container = render(baseField({ field_label: '<img src=x onerror=alert(1)>' }));

    const input = container.querySelector('#propFieldLabel');
    expect(input.value).toBe('<img src=x onerror=alert(1)>');
    // If this weren't escaped, the string would have been parsed as a real
    // <img> element rather than surviving as the input's value attribute.
    expect(container.querySelector('img')).toBeNull();
  });

  it('checks the required checkbox when the field is required', () => {
    const container = render(baseField({ required: true }));

    expect(container.querySelector('#propRequired').checked).toBe(true);
  });

  it('shows the choices textarea only for choice-based field types', () => {
    const shown = render(baseField({ field_type: 'select' }));
    const hidden = render(baseField({ field_type: 'text' }));

    expect(shown.querySelector('#propChoices')).not.toBeNull();
    expect(hidden.querySelector('#propChoices')).toBeNull();
  });

  it('shows the formula input only for calculated fields', () => {
    const shown = render(baseField({ field_type: 'calculated', default_value: '{a}+{b}' }));
    const hidden = render(baseField({ field_type: 'text' }));

    expect(shown.querySelector('#propDefaultValue').value).toBe('{a}+{b}');
    expect(hidden.querySelector('#propDefaultValue')).toBeNull();
  });

  it('shows the markdown textarea only for display_text fields', () => {
    const shown = render(baseField({ field_type: 'display_text', default_value: '**hi**' }));
    const hidden = render(baseField({ field_type: 'text' }));

    expect(shown.querySelector('#propDefaultValue').tagName).toBe('TEXTAREA');
    expect(hidden.querySelector('#propDefaultValue')).toBeNull();
  });

  it('shows the max-stars input, defaulting to 5, only for rating fields', () => {
    const withDefault = render(baseField({ field_type: 'rating' }));
    const withOverride = render(baseField({ field_type: 'rating', validation: { max_value: 8 } }));
    const hidden = render(baseField({ field_type: 'text' }));

    expect(withDefault.querySelector('#propMaxValue').value).toBe('5');
    expect(withOverride.querySelector('#propMaxValue').value).toBe('8');
    expect(hidden.querySelector('#propMaxValue')).toBeNull();
  });

  it('shows min/max/step inputs only for slider fields', () => {
    const shown = render(baseField({ field_type: 'slider', validation: { min_value: 0, max_value: 100 } }));
    const hidden = render(baseField({ field_type: 'text' }));

    expect(shown.querySelector('#propMinValue')).not.toBeNull();
    expect(shown.querySelector('#propMaxValue')).not.toBeNull();
    expect(hidden.querySelector('#propMinValue')).toBeNull();
  });

  it('shows the matrix JSON textarea, with a default template, only for matrix fields', () => {
    const shown = render(baseField({ field_type: 'matrix', choices: '' }));
    const hidden = render(baseField({ field_type: 'text' }));

    expect(shown.querySelector('#propChoices').value).toContain('"rows"');
    expect(hidden.querySelector('#propChoices')).toBeNull();
  });

  it('shows the shared-option-list select, populated from config, only for choice-based fields', () => {
    const ctx = createContext({
      sharedOptionLists: [{ id: 7, name: 'Colors', itemCount: 3 }],
    });
    const shown = render(baseField({ field_type: 'checkboxes' }), ctx);
    const hidden = render(baseField({ field_type: 'text' }), ctx);

    const option = shown.querySelector('#propSharedOptionList option[value="7"]');
    expect(option.textContent).toContain('Colors');
    expect(hidden.querySelector('#propSharedOptionList')).toBeNull();
  });
});
