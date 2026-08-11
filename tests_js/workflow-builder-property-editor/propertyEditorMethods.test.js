import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { propertyEditorMethods } from '../../django_forms_workflows/static/django_forms_workflows/js/workflow-builder-property-editor.js';
import { createWorkflowBuilderStore } from '../../django_forms_workflows/static/django_forms_workflows/js/workflow-builder-store.js';

function createContext({
  nodes = [], connections = [], fields = [], groups = [], forms = [], workflowTargets = [], config = {},
} = {}) {
  const store = createWorkflowBuilderStore();
  store.setNodes(nodes);
  store.setConnections(connections);
  return {
    store, config, fields, groups, forms, workflowTargets,
    // Real implementation (matches workflow-builder.js#escapeHtml) rather
    // than a stub - cheap under jsdom and several assertions depend on
    // actual escaping behavior.
    escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    },
    getNodeTypeLabel: vi.fn((type) => type),
    buildNodeIssuesAlert: vi.fn(() => ''),
    buildPropertySection: vi.fn((title, inner) => `<section data-title="${title}">${inner}</section>`),
    render: vi.fn(),
    refreshValidationState: vi.fn(),
    selectNode: vi.fn(),
    get nodes() { return this.store.nodes; },
    set nodes(v) { this.store.setNodes(v); },
    get connections() { return this.store.connections; },
    set connections(v) { this.store.setConnections(v); },
    ...propertyEditorMethods,
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('propertyEditorMethods.showEmptyProperties', () => {
  it('renders the placeholder state', () => {
    document.body.innerHTML = '<div id="propertiesContent"></div>';
    const ctx = createContext();

    ctx.showEmptyProperties();

    expect(document.getElementById('propertiesContent').innerHTML).toContain('Select a node to edit its properties');
  });
});

describe('propertyEditorMethods.buildPropertiesForm', () => {
  const cases = [
    ['form', 'buildFormProperties'],
    ['workflow_settings', 'buildWorkflowSettingsProperties'],
    ['stage', 'buildStageProperties'],
    ['approval', 'buildApprovalProperties'],
    ['condition', 'buildConditionProperties'],
    ['action', 'buildActionProperties'],
    ['email', 'buildEmailProperties'],
    ['sub_workflow', 'buildSubWorkflowProperties'],
    ['end', 'buildEndProperties'],
  ];

  it.each(cases)('dispatches %s nodes to %s', (type, methodName) => {
    const ctx = createContext();
    ctx[methodName] = vi.fn(() => `__${methodName}__`);
    const node = { id: 'n1', type, data: {} };

    const html = ctx.buildPropertiesForm(node);

    expect(ctx[methodName]).toHaveBeenCalledWith(node);
    expect(html).toContain(`__${methodName}__`);
  });

  it('renders a static message for start nodes without delegating', () => {
    const ctx = createContext();
    const html = ctx.buildPropertiesForm({ id: 'n1', type: 'start', data: {} });
    expect(html).toContain('This is the workflow start point.');
  });

  it('renders a static message for join nodes without delegating', () => {
    const ctx = createContext();
    const html = ctx.buildPropertiesForm({ id: 'n1', type: 'join', data: {} });
    expect(html).toContain('automatically merges parallel approval stages');
  });

  it('includes the node type label header and any issues alert', () => {
    const ctx = createContext();
    ctx.getNodeTypeLabel = vi.fn(() => 'Approval Stage');
    ctx.buildNodeIssuesAlert = vi.fn(() => '<div class="issue">bad</div>');

    const html = ctx.buildPropertiesForm({ id: 'n1', type: 'start', data: {} });

    expect(html).toContain('<h6 class="mb-3">Approval Stage</h6>');
    expect(html).toContain('<div class="issue">bad</div>');
  });

  it('escapes an unrecognized node type instead of injecting it raw', () => {
    const ctx = createContext();
    ctx.getNodeTypeLabel = vi.fn((type) => type);

    const html = ctx.buildPropertiesForm({ id: 'n1', type: '"><script>alert(1)</script>', data: {} });

    expect(html).not.toContain('<script>alert');
  });
});

describe('propertyEditorMethods.getNormalizedStageApprovalGroups', () => {
  it('drops groups without an id', () => {
    const ctx = createContext();
    expect(ctx.getNormalizedStageApprovalGroups([{ name: 'no id' }, null])).toEqual([]);
  });

  it('sorts by position, then by name, and re-indexes position', () => {
    const ctx = createContext();
    const result = ctx.getNormalizedStageApprovalGroups([
      { id: 3, name: 'Charlie', position: 1 },
      { id: 1, name: 'Alpha', position: 0 },
      { id: 2, name: 'Bravo', position: 1 },
    ]);

    expect(result.map((g) => g.id)).toEqual([1, 2, 3]);
    expect(result.map((g) => g.position)).toEqual([0, 1, 2]);
  });

  it('treats a missing position as 0', () => {
    const ctx = createContext();
    const result = ctx.getNormalizedStageApprovalGroups([
      { id: 1, name: 'Zebra' },
      { id: 2, name: 'Alpha' },
    ]);
    expect(result.map((g) => g.id)).toEqual([2, 1]);
  });
});

describe('propertyEditorMethods.buildStageApprovalOrderEditor', () => {
  it('shows a hint when no groups are selected', () => {
    const ctx = createContext();
    const html = ctx.buildStageApprovalOrderEditor({ id: 'n1' }, []);
    expect(html).toContain('Select one or more approval groups above');
  });

  it('renders each group with move buttons, disabling at the ends', () => {
    const ctx = createContext();
    const groups = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }, { id: 3, name: 'C' }];

    const html = ctx.buildStageApprovalOrderEditor({ id: 'n1' }, groups);
    document.body.innerHTML = `<div id="wrap">${html}</div>`;
    const rows = document.querySelectorAll('#wrap .list-group-item');

    expect(rows).toHaveLength(3);
    expect(rows[0].querySelector('.bi-arrow-up').closest('button').disabled).toBe(true);
    expect(rows[2].querySelector('.bi-arrow-down').closest('button').disabled).toBe(true);
    expect(rows[1].querySelector('.bi-arrow-up').closest('button').disabled).toBe(false);
    expect(html).toContain("workflowBuilder.moveStageApprovalGroup('n1', 2, -1)");
  });
});

describe('propertyEditorMethods.buildStageProperties', () => {
  it('renders escaped name/approve_label and reflects checkbox state', () => {
    const ctx = createContext({ groups: [{ id: 1, name: 'Finance' }], fields: [] });
    const node = {
      id: 'n1',
      data: {
        name: '<b>Stage</b>',
        order: 2,
        approve_label: 'Sign "Off"',
        requires_manager_approval: true,
        approval_groups: [{ id: 1, name: 'Finance', position: 0 }],
      },
    };

    const html = ctx.buildStageProperties(node);
    document.body.innerHTML = `<div id="wrap">${html}</div>`;

    expect(document.querySelector('input[name="name"]').value).toBe('<b>Stage</b>');
    expect(document.querySelector('input[name="order"]').value).toBe('2');
    expect(document.querySelector('#stage_requires_manager_n1').checked).toBe(true);
    expect(document.querySelector('#stage_allow_send_back_n1').checked).toBe(false);
    expect(document.querySelector('option[value="1"]').selected).toBe(true);
  });

  it('defaults order to 1 when unset', () => {
    const ctx = createContext();
    const html = ctx.buildStageProperties({ id: 'n1', data: {} });
    document.body.innerHTML = `<div id="wrap">${html}</div>`;
    expect(document.querySelector('input[name="order"]').value).toBe('1');
  });

  it('escapes order so it cannot break out of the value attribute', () => {
    const ctx = createContext();
    const html = ctx.buildStageProperties({ id: 'n1', data: { order: '"><script>alert(1)</script>' } });
    expect(html).not.toContain('<script>alert');
  });

  it('escapes group.id in the approval-groups option value', () => {
    const ctx = createContext({ groups: [{ id: '"><script>alert(1)</script>', name: 'Ops' }] });
    const html = ctx.buildStageProperties({ id: 'n1', data: {} });
    expect(html).not.toContain('<script>alert');
  });

  it('escapes field.id and field.field_name in the approval-fields option', () => {
    const payload = '"><script>alert(1)</script>';
    const ctx = createContext({ fields: [{ id: payload, field_name: payload, field_label: 'Requester' }] });
    const html = ctx.buildStageProperties({ id: 'n1', data: {} });
    expect(html).not.toContain('<script>alert');
  });
});

describe('propertyEditorMethods.buildWorkflowSettingsProperties', () => {
  it('renders identity and timing fields, and includes the notification/trigger sub-editors', () => {
    const ctx = createContext();
    ctx.buildNotificationRulesEditor = vi.fn(() => '__NOTIF_EDITOR__');
    ctx.buildTriggerConditionsEditor = vi.fn(() => '__TRIGGER_EDITOR__');
    const node = { id: 'n1', data: { name_label: 'Finance Track', approval_deadline_days: 5 } };

    const html = ctx.buildWorkflowSettingsProperties(node);
    document.body.innerHTML = `<div id="wrap">${html}</div>`;

    expect(document.querySelector('input[name="name_label"]').value).toBe('Finance Track');
    expect(document.querySelector('input[name="approval_deadline_days"]').value).toBe('5');
    expect(html).toContain('__NOTIF_EDITOR__');
    expect(html).toContain('__TRIGGER_EDITOR__');
    expect(ctx.buildNotificationRulesEditor).toHaveBeenCalledWith(node);
  });

  it('escapes the numeric deadline/cadence fields so none can break out of their value attribute', () => {
    const ctx = createContext();
    ctx.buildNotificationRulesEditor = vi.fn(() => '');
    ctx.buildTriggerConditionsEditor = vi.fn(() => '');
    const payload = '"><script>alert(1)</script>';
    const node = {
      id: 'n1',
      data: {
        approval_deadline_days: payload,
        send_reminder_after_days: payload,
        auto_approve_after_days: payload,
        notification_cadence_day: payload,
      },
    };

    const html = ctx.buildWorkflowSettingsProperties(node);

    expect(html).not.toContain('<script>alert');
  });

  it('escapes field.field_name in the date-field option', () => {
    const payload = '"><script>alert(1)</script>';
    const ctx = createContext({ fields: [{ field_name: payload, field_label: 'Due Date' }] });
    ctx.buildNotificationRulesEditor = vi.fn(() => '');
    ctx.buildTriggerConditionsEditor = vi.fn(() => '');
    const html = ctx.buildWorkflowSettingsProperties({ id: 'n1', data: {} });
    expect(html).not.toContain('<script>alert');
  });
});

describe('propertyEditorMethods.getNotificationRuleStageOptions', () => {
  it('lists only stage nodes, sorted by order then name', () => {
    const ctx = createContext({
      nodes: [
        { id: 's2', type: 'stage', data: { name: 'Zeta', order: 1 } },
        { id: 's1', type: 'stage', data: { name: 'Alpha', order: 1 } },
        { id: 'e1', type: 'end', data: {} },
      ],
    });

    const options = ctx.getNotificationRuleStageOptions();

    expect(options.map((o) => o.nodeId)).toEqual(['s1', 's2']);
  });

  it('defaults an unnamed stage', () => {
    const ctx = createContext({ nodes: [{ id: 's1', type: 'stage', data: {} }] });
    expect(ctx.getNotificationRuleStageOptions()[0].name).toBe('Unnamed Stage');
  });
});

describe('propertyEditorMethods.getNotificationRuleState', () => {
  it('fills in defaults for a bare rule', () => {
    const ctx = createContext();
    expect(ctx.getNotificationRuleState(null)).toEqual({
      rule_id: null, stage_id: null, stage_node_id: '', event: 'approval_request',
      subject_template: '', notify_submitter: false, email_field: '', static_emails: '',
      notify_stage_assignees: false, notify_stage_groups: false, notify_groups: [], conditions: null,
    });
  });

  it('normalizes notify_groups from plain ids and drops falsy ids', () => {
    const ctx = createContext();
    const state = ctx.getNotificationRuleState({ notify_groups: [1, { id: 2, name: 'B' }, 0] });
    expect(state.notify_groups).toEqual([{ id: 1, name: '1' }, { id: 2, name: 'B' }]);
  });
});

describe('propertyEditorMethods.buildNotificationRulesEditor', () => {
  it('renders one blank rule card with no remove button when there are no rules yet', () => {
    const ctx = createContext();
    const html = ctx.buildNotificationRulesEditor({ id: 'n1', data: {} });
    document.body.innerHTML = `<div id="wrap">${html}</div>`;
    expect(document.querySelectorAll('.notification-rule-card')).toHaveLength(1);
    expect(document.querySelector('.notification-rule-card button.btn-outline-danger')).toBeNull();
  });

  it('renders a card per existing rule, each with a remove button', () => {
    const ctx = createContext();
    const node = {
      id: 'n1',
      data: { notification_rules: [{ event: 'workflow_approved' }, { event: 'workflow_denied' }] },
    };
    const html = ctx.buildNotificationRulesEditor(node);
    document.body.innerHTML = `<div id="wrap">${html}</div>`;
    const cards = document.querySelectorAll('.notification-rule-card');
    expect(cards).toHaveLength(2);
    cards.forEach((card) => expect(card.querySelector('button.btn-outline-danger')).not.toBeNull());
  });

  it('marks selected notify_groups options', () => {
    const ctx = createContext({ groups: [{ id: 1, name: 'Ops' }, { id: 2, name: 'Finance' }] });
    const node = { id: 'n1', data: { notification_rules: [{ notify_groups: [2] }] } };
    const html = ctx.buildNotificationRulesEditor(node);
    document.body.innerHTML = `<div id="wrap">${html}</div>`;
    expect(document.querySelector('option[value="2"]').selected).toBe(true);
    expect(document.querySelector('option[value="1"]').selected).toBe(false);
  });

  it('escapes rule_id so it cannot break out of the data-rule-id attribute', () => {
    const ctx = createContext();
    const node = { id: 'n1', data: { notification_rules: [{ rule_id: '"><script>alert(1)</script>' }] } };
    const html = ctx.buildNotificationRulesEditor(node);
    expect(html).not.toContain('<script>alert');
  });

  it('escapes group.id in the notify_groups option value', () => {
    const ctx = createContext({ groups: [{ id: '"><script>alert(1)</script>', name: 'Ops' }] });
    const html = ctx.buildNotificationRulesEditor({ id: 'n1', data: {} });
    expect(html).not.toContain('<script>alert');
  });

  it('escapes field.field_name in the email-field option', () => {
    const payload = '"><script>alert(1)</script>';
    const ctx = createContext({ fields: [{ field_name: payload, field_label: 'Requester' }] });
    const html = ctx.buildNotificationRulesEditor({ id: 'n1', data: {} });
    expect(html).not.toContain('<script>alert');
  });

  it('escapes the stage order in the rule-scope option text', () => {
    const payload = '"><script>alert(1)</script>';
    const ctx = createContext({ nodes: [{ id: 's1', type: 'stage', data: { name: 'Review', order: payload } }] });
    const html = ctx.buildNotificationRulesEditor({ id: 'n1', data: {} });
    expect(html).not.toContain('<script>alert');
  });
});

describe('propertyEditorMethods.getNormalizedTriggerConditions', () => {
  it('returns an empty AND group for falsy input', () => {
    const ctx = createContext();
    expect(ctx.getNormalizedTriggerConditions(null)).toEqual({ operator: 'AND', conditions: [] });
  });

  it('normalizes the array form, uppercasing and defaulting the operator', () => {
    const ctx = createContext();
    const result = ctx.getNormalizedTriggerConditions({
      operator: 'or', conditions: [{ field: 'x', operator: 'gt', value: '1' }],
    });
    expect(result).toEqual({ operator: 'OR', conditions: [{ field: 'x', operator: 'gt', value: '1' }] });
  });

  it('wraps the legacy single-condition form', () => {
    const ctx = createContext();
    const result = ctx.getNormalizedTriggerConditions({ field: 'x', operator: 'equals', value: '1' });
    expect(result).toEqual({ operator: 'AND', conditions: [{ field: 'x', operator: 'equals', value: '1' }] });
  });
});

describe('propertyEditorMethods.buildConditionsEditor', () => {
  it('renders a hint row when there are no conditions', () => {
    const ctx = createContext();
    const html = ctx.buildConditionsEditor({ title: 'T', conditions: null, onChangeHandler: 'noop()', editorKind: 'k' });
    expect(html).toContain('Always run unless you add at least one condition.');
  });

  it('renders a row per condition and disables the value input for is_empty/not_empty', () => {
    const ctx = createContext({ fields: [{ field_name: 'age', field_label: 'Age' }] });
    const html = ctx.buildConditionsEditor({
      title: 'T', onChangeHandler: 'noop()', editorKind: 'k',
      conditions: { operator: 'AND', conditions: [{ field: 'age', operator: 'is_empty', value: '' }] },
    });
    document.body.innerHTML = `<div id="wrap">${html}</div>`;
    expect(document.querySelectorAll('.trigger-condition-row')).toHaveLength(1);
    expect(document.querySelector('input[name="condition_value"]').disabled).toBe(true);
  });

  it('shows/hides the header per showHeader, and escapes the title', () => {
    const ctx = createContext();
    const shown = ctx.buildConditionsEditor({ title: '<b>T</b>', onChangeHandler: 'noop()', editorKind: 'k', conditions: null, showHeader: true });
    const hidden = ctx.buildConditionsEditor({ title: '<b>T</b>', onChangeHandler: 'noop()', editorKind: 'k', conditions: null, showHeader: false });
    expect(shown).toContain('&lt;b&gt;T&lt;/b&gt;');
    expect(hidden).not.toContain('<h6>');
  });

  it('substitutes __INDEX__ in the remove handler with the row index', () => {
    const ctx = createContext();
    const html = ctx.buildConditionsEditor({
      title: 'T', onChangeHandler: 'noop()', editorKind: 'k',
      removeConditionHandler: "workflowBuilder.removeTriggerCondition('n1', __INDEX__)",
      conditions: { operator: 'AND', conditions: [{ field: 'a', operator: 'equals', value: '1' }, { field: 'b', operator: 'equals', value: '2' }] },
    });
    expect(html).toContain("workflowBuilder.removeTriggerCondition('n1', 0)");
    expect(html).toContain("workflowBuilder.removeTriggerCondition('n1', 1)");
  });

  it('escapes field.field_name in the condition-field option', () => {
    const payload = '"><script>alert(1)</script>';
    const ctx = createContext({ fields: [{ field_name: payload, field_label: 'Age' }] });
    const html = ctx.buildConditionsEditor({
      title: 'T', onChangeHandler: 'noop()', editorKind: 'k',
      conditions: { operator: 'AND', conditions: [{ field: payload, operator: 'equals', value: '1' }] },
    });
    expect(html).not.toContain('<script>alert');
  });
});

describe('propertyEditorMethods.buildTriggerConditionsEditor', () => {
  it('wraps buildConditionsEditor output in a property section with the given title', () => {
    const ctx = createContext();
    ctx.buildConditionsEditor = vi.fn(() => '__CONDITIONS__');
    const node = { id: 'n1', data: { trigger_conditions: null } };

    const html = ctx.buildTriggerConditionsEditor(node, 'Stage trigger conditions');

    expect(ctx.buildPropertySection).toHaveBeenCalledWith(
      'Stage trigger conditions', expect.stringContaining('__CONDITIONS__'), expect.objectContaining({ icon: 'funnel' })
    );
    expect(html).toContain('__CONDITIONS__');
    expect(html).toContain("workflowBuilder.addTriggerCondition('n1')");
  });
});

describe('propertyEditorMethods.buildFormProperties', () => {
  it('escapes field.name, field.type, and field.prefill_source in the field list', () => {
    const ctx = createContext();
    const payload = '"><script>alert(1)</script>';
    const node = {
      id: 'form_1',
      data: {
        is_initial: true, form_name: 'Test Form', field_count: 1,
        fields: [{ label: payload, name: payload, type: payload, prefill_source: payload }],
        has_more_fields: false,
      },
    };

    const html = ctx.buildFormProperties(node);

    expect(html).not.toContain('<script>alert');
  });

  it('shows a form selector for non-initial nodes and a read-only name for initial ones', () => {
    const ctx = createContext({ forms: [{ id: 5, name: 'Vacation Request', field_count: 3 }] });

    const additional = ctx.buildFormProperties({ id: 'n1', data: { is_initial: false } });
    document.body.innerHTML = `<div id="wrap">${additional}</div>`;
    expect(document.querySelector('select[name="form_id"]')).not.toBeNull();
    expect(document.querySelector('option[value="5"]').textContent).toContain('Vacation Request');

    const initial = ctx.buildFormProperties({ id: 'n1', data: { is_initial: true, form_name: 'Intake' } });
    document.body.innerHTML = `<div id="wrap">${initial}</div>`;
    expect(document.querySelector('select[name="form_id"]')).toBeNull();
    expect(document.querySelector('input[disabled]').value).toBe('Intake');
  });

  it('shows multi-step info only when enabled with steps present', () => {
    const ctx = createContext();
    const node = {
      id: 'n1',
      data: {
        is_initial: true, enable_multi_step: true, step_count: 2,
        form_steps: [{ title: 'Step One', fields: [{}] }, { title: 'Step Two', fields: [] }],
      },
    };
    const html = ctx.buildFormProperties(node);
    expect(html).toContain('Multi-Step Form');
    expect(html).toContain('Step One');
    expect(html).toContain('Step Two');
    expect(html).toContain('2 steps configured');
  });

  it('shows a "more fields" indicator when has_more_fields is set', () => {
    const ctx = createContext();
    const html = ctx.buildFormProperties({ id: 'n1', data: { is_initial: true, fields: [{ label: 'A', name: 'a', type: 'text' }], has_more_fields: true } });
    expect(html).toContain('More fields available');
  });

  it('escapes form_builder_url so it cannot break out of the href attribute', () => {
    const ctx = createContext();
    const html = ctx.buildFormProperties({ id: 'n1', data: { is_initial: true, form_builder_url: '"><script>alert(1)</script>' } });
    expect(html).not.toContain('<script>alert');
  });

  it('escapes field_count in both the form-selector option text and the read-only total', () => {
    const payload = '"><script>alert(1)</script>';
    const ctx = createContext({ forms: [{ id: 5, name: 'Vacation Request', field_count: payload }] });

    const dropdown = ctx.buildFormProperties({ id: 'n1', data: { is_initial: false } });
    expect(dropdown).not.toContain('<script>alert');

    const readOnly = ctx.buildFormProperties({ id: 'n1', data: { is_initial: true, field_count: payload } });
    expect(readOnly).not.toContain('<script>alert');
  });
});

describe('propertyEditorMethods.buildApprovalProperties', () => {
  it('shows the group selector for group approval (including the unset default)', () => {
    const ctx = createContext({ groups: [{ id: 1, name: 'Ops' }] });
    const html = ctx.buildApprovalProperties({ id: 'n1', data: {} });
    expect(html).toContain('name="group_id"');
  });

  it('hides the group selector for manager/parallel approval', () => {
    const ctx = createContext();
    const html = ctx.buildApprovalProperties({ id: 'n1', data: { approval_type: 'manager' } });
    expect(html).not.toContain('name="group_id"');
  });
});

describe('propertyEditorMethods.buildConditionProperties', () => {
  it('renders the legacy-node notice', () => {
    const ctx = createContext();
    expect(ctx.buildConditionProperties({ id: 'n1', data: {} })).toContain('Legacy condition nodes are not currently persisted');
  });
});

describe('propertyEditorMethods.buildActionProperties', () => {
  it('stringifies an object config and escapes the name', () => {
    const ctx = createContext();
    const node = { id: 'n1', data: { name: '<b>Act</b>', config: { table: 'users' } } };
    const html = ctx.buildActionProperties(node);
    expect(html).toContain('&lt;b&gt;Act&lt;/b&gt;');
    expect(html).toContain('"table": "users"');
  });

  it('passes through a string config as-is', () => {
    const ctx = createContext();
    const html = ctx.buildActionProperties({ id: 'n1', data: { config: '{"a":1}' } });
    expect(html).toContain('{"a":1}');
  });
});

describe('propertyEditorMethods.buildEmailProperties', () => {
  it('marks the currently-selected recipient/cc fields and trigger', () => {
    const ctx = createContext({ fields: [{ field_name: 'requester_email', field_label: 'Requester Email' }] });
    const node = { id: 'n1', data: { email_to_field: 'requester_email', trigger: 'on_approve' } };

    const html = ctx.buildEmailProperties(node);
    document.body.innerHTML = `<div id="wrap">${html}</div>`;

    expect(document.querySelector('select[name="email_to_field"] option[value="requester_email"]').selected).toBe(true);
    expect(document.querySelector('select[name="trigger"] option[value="on_approve"]').selected).toBe(true);
  });

  it('escapes field.field_name in both the to and cc field options', () => {
    const payload = '"><script>alert(1)</script>';
    const ctx = createContext({ fields: [{ field_name: payload, field_label: 'Requester' }] });
    const html = ctx.buildEmailProperties({ id: 'n1', data: {} });
    expect(html).not.toContain('<script>alert');
  });
});

describe('propertyEditorMethods.buildSubWorkflowProperties', () => {
  it('marks the selected target workflow and count field', () => {
    const ctx = createContext({
      workflowTargets: [{ workflow_id: 7, form_id: 2, workflow_label: 'Payment Approvals', field_count: 4 }],
      fields: [{ field_name: 'payment_count', field_label: 'Payment Count' }],
    });
    const node = { id: 'n1', data: { sub_workflow_id: 7, count_field: 'payment_count' } };

    const html = ctx.buildSubWorkflowProperties(node);
    document.body.innerHTML = `<div id="wrap">${html}</div>`;

    expect(document.querySelector('select[name="sub_workflow_id"] option[value="7"]').selected).toBe(true);
    expect(document.querySelector('select[name="count_field"] option[value="payment_count"]').selected).toBe(true);
  });

  it('defaults the label template', () => {
    const ctx = createContext();
    const html = ctx.buildSubWorkflowProperties({ id: 'n1', data: {} });
    document.body.innerHTML = `<div id="wrap">${html}</div>`;
    expect(document.querySelector('input[name="label_template"]').value).toBe('Sub-workflow {index}');
  });

  it('escapes target.field_count in the workflow dropdown option text', () => {
    const ctx = createContext({
      workflowTargets: [{ workflow_id: 7, form_id: 2, workflow_label: 'Payment Approvals', field_count: '"><script>alert(1)</script>' }],
    });
    const html = ctx.buildSubWorkflowProperties({ id: 'n1', data: {} });
    expect(html).not.toContain('<script>alert');
  });

  it('escapes field.field_name in the count-field option', () => {
    const payload = '"><script>alert(1)</script>';
    const ctx = createContext({ fields: [{ field_name: payload, field_label: 'Count' }] });
    const html = ctx.buildSubWorkflowProperties({ id: 'n1', data: {} });
    expect(html).not.toContain('<script>alert');
  });

  it('escapes target.workflow_id and target.form_id in the workflow option attributes', () => {
    const payload = '"><script>alert(1)</script>';
    const ctx = createContext({
      workflowTargets: [{ workflow_id: payload, form_id: payload, workflow_label: 'Payment Approvals', field_count: 4 }],
    });
    const html = ctx.buildSubWorkflowProperties({ id: 'n1', data: {} });
    expect(html).not.toContain('<script>alert');
  });
});

describe('propertyEditorMethods.updateSubWorkflowConfig', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="propertiesContent">
        <select name="sub_workflow_id">
          <option value="">--</option>
          <option value="7" data-form-id="2">Payment Approvals (4 fields)</option>
        </select>
        <input name="section_label" value="Payments" />
        <select name="count_field"><option value="payment_count" selected>Payment Count</option></select>
        <input name="label_template" value="Payment {index}" />
        <select name="trigger"><option value="on_approval" selected>After Parent Approval</option></select>
        <input name="data_prefix" value="payment" />
        <input type="checkbox" id="sub_wf_detached_n1" checked />
        <input type="checkbox" id="sub_wf_reject_parent_n1" />
      </div>
    `;
    document.querySelector('select[name="sub_workflow_id"] option[value="7"]').selected = true;
  });

  it('reads every field back onto node.data and re-renders', () => {
    const node = { id: 'n1', data: {} };
    const ctx = createContext({ nodes: [node] });

    ctx.updateSubWorkflowConfig('n1');

    expect(node.data).toMatchObject({
      sub_workflow_id: 7,
      sub_workflow_name: 'Payment Approvals (4 fields)',
      sub_workflow_form_id: 2,
      section_label: 'Payments',
      count_field: 'payment_count',
      label_template: 'Payment {index}',
      trigger: 'on_approval',
      data_prefix: 'payment',
      detached: true,
      reject_parent: false,
    });
    expect(ctx.render).toHaveBeenCalled();
    expect(ctx.selectNode).toHaveBeenCalledWith('n1');
  });

  it('does nothing when the node is not found', () => {
    const ctx = createContext({ nodes: [] });
    expect(() => ctx.updateSubWorkflowConfig('missing')).not.toThrow();
    expect(ctx.render).not.toHaveBeenCalled();
  });
});

describe('propertyEditorMethods.buildEndProperties', () => {
  it('renders the terminal-node notice', () => {
    const ctx = createContext();
    expect(ctx.buildEndProperties({ id: 'n1', data: {} })).toContain('workflow completes when it reaches this node');
  });
});

describe('propertyEditorMethods.updateNodeProperty', () => {
  it('sets the given property and re-renders', () => {
    const node = { id: 'n1', data: { x: 1 } };
    const ctx = createContext({ nodes: [node] });
    ctx.updateNodeProperty('n1', 'x', 42);
    expect(node.data.x).toBe(42);
    expect(ctx.render).toHaveBeenCalled();
  });

  it('does nothing when the node is not found', () => {
    const ctx = createContext({ nodes: [] });
    expect(() => ctx.updateNodeProperty('missing', 'x', 1)).not.toThrow();
    expect(ctx.render).not.toHaveBeenCalled();
  });
});

describe('propertyEditorMethods.updateFormSelection', () => {
  it('populates node.data from the selected form', () => {
    const node = { id: 'n1', data: {} };
    const ctx = createContext({ nodes: [node], forms: [{ id: 5, name: 'Vacation Request', field_count: 3 }] });

    ctx.updateFormSelection('n1', '5');

    expect(node.data).toMatchObject({
      form_id: 5, form_name: 'Vacation Request', field_count: 3, fields: [], has_more_fields: true,
      form_builder_url: '/admin/django_forms_workflows/formdefinition/5/builder/',
    });
    expect(ctx.render).toHaveBeenCalled();
    expect(ctx.selectNode).toHaveBeenCalledWith('n1');
  });

  it('clears node.data when no form matches', () => {
    const node = { id: 'n1', data: { form_id: 5 } };
    const ctx = createContext({ nodes: [node], forms: [] });

    ctx.updateFormSelection('n1', '');

    expect(node.data).toMatchObject({ form_id: null, form_name: 'Select Form', form_builder_url: '#', field_count: 0, fields: [], has_more_fields: false });
  });
});

describe('propertyEditorMethods.updateStageConfig', () => {
  function buildFixture({ groupOptions = '', fieldOptions = '' } = {}) {
    document.body.innerHTML = `
      <div id="propertiesContent">
        <input name="name" value="Manager Review" />
        <input name="order" value="3" />
        <input name="approve_label" value="Approve It" />
        <input type="checkbox" id="stage_requires_manager_n1" checked />
        <input type="checkbox" id="stage_allow_send_back_n1" />
        <input type="checkbox" id="stage_allow_reassign_n1" checked />
        <input type="checkbox" id="stage_allow_edit_form_data_n1" />
        <select name="assignee_form_field"><option value="approver_email" selected>Approver Email</option></select>
        <select name="assignee_lookup_type"><option value="email" selected>Email</option></select>
        <input type="checkbox" id="stage_validate_assignee_group_n1" checked />
        <select id="stage_groups_n1" multiple>${groupOptions}</select>
        <select id="stage_fields_n1" multiple>${fieldOptions}</select>
        <select name="approval_logic"><option value="all" selected>All (AND)</option></select>
        <div class="conditions-editor" data-editor-kind="node-trigger">
          <select name="condition_group_operator"><option value="AND" selected>AND</option></select>
        </div>
      </div>
    `;
  }

  it('reads every field back onto node.data, including nested reads via the trigger/group/field readers', () => {
    buildFixture({
      groupOptions: '<option value="1" selected>Finance</option>',
      fieldOptions: '<option value="9" selected>Requester</option>',
    });
    const node = { id: 'n1', data: { approval_groups: [] } };
    const ctx = createContext({ nodes: [node], fields: [{ id: 9, field_name: 'requester', field_label: 'Requester' }] });

    ctx.updateStageConfig('n1');

    expect(node.data).toMatchObject({
      name: 'Manager Review',
      order: 3,
      approve_label: 'Approve It',
      requires_manager_approval: true,
      allow_send_back: false,
      allow_reassign: true,
      allow_edit_form_data: false,
      assignee_form_field: 'approver_email',
      assignee_lookup_type: 'email',
      validate_assignee_group: true,
      approval_logic: 'all',
      trigger_conditions: null,
    });
    expect(node.data.approval_groups).toEqual([{ id: 1, name: 'Finance', position: 0 }]);
    expect(node.data.approval_fields).toEqual([{ id: 9, field_name: 'requester', field_label: 'Requester', field_type: '', order: 0 }]);
    expect(ctx.render).toHaveBeenCalled();
  });

  it('falls back to order 1 when the order input is not a number', () => {
    buildFixture();
    document.querySelector('input[name="order"]').value = '';
    const node = { id: 'n1', data: {} };
    const ctx = createContext({ nodes: [node] });

    ctx.updateStageConfig('n1');

    expect(node.data.order).toBe(1);
  });
});

describe('propertyEditorMethods.updateWorkflowSettings', () => {
  function buildFixture() {
    document.body.innerHTML = `
      <div id="propertiesContent">
        <input name="approval_deadline_days" value="5" />
        <input name="send_reminder_after_days" value="" />
        <input name="auto_approve_after_days" value="10" />
        <input name="name_label" value="Finance Track" />
        <select name="notification_cadence"><option value="daily" selected>Daily</option></select>
        <input name="notification_cadence_day" value="2" />
        <input name="notification_cadence_time" value="09:00" />
        <select name="notification_cadence_form_field"><option value="due_date" selected>Due Date</option></select>
      </div>
    `;
  }

  it('parses numeric fields (empty -> null) and reads the notification/trigger sub-state', () => {
    buildFixture();
    const node = { id: 'n1', data: {} };
    const ctx = createContext({ nodes: [node] });
    ctx.readNotificationRulesFromPanel = vi.fn(() => ['__RULE__']);
    ctx.readNodeTriggerConditions = vi.fn(() => ({ operator: 'AND', conditions: [] }));

    ctx.updateWorkflowSettings('n1');

    expect(node.data).toMatchObject({
      approval_deadline_days: 5,
      send_reminder_after_days: null,
      auto_approve_after_days: 10,
      name_label: 'Finance Track',
      notification_cadence: 'daily',
      notification_cadence_day: 2,
      notification_cadence_time: '09:00',
      notification_cadence_form_field: 'due_date',
      notification_rules: ['__RULE__'],
      trigger_conditions: { operator: 'AND', conditions: [] },
    });
    expect(ctx.render).toHaveBeenCalled();
  });
});

describe('propertyEditorMethods.readConditionsFromEditor', () => {
  it('returns null for a missing editor element', () => {
    const ctx = createContext();
    expect(ctx.readConditionsFromEditor(null)).toBeNull();
  });

  it('returns null when there are no rows with a selected field', () => {
    document.body.innerHTML = `
      <div id="editor">
        <select name="condition_group_operator"><option value="AND" selected>AND</option></select>
        <div class="trigger-condition-row">
          <select name="condition_field"><option value="" selected></option></select>
          <select name="condition_operator"><option value="equals" selected>Equals</option></select>
          <input name="condition_value" value="x" />
        </div>
      </div>
    `;
    const ctx = createContext();
    expect(ctx.readConditionsFromEditor(document.getElementById('editor'))).toBeNull();
  });

  it('reads rows with a field, skipping the value input for is_empty/not_empty', () => {
    document.body.innerHTML = `
      <div id="editor">
        <select name="condition_group_operator"><option value="OR" selected>OR</option></select>
        <div class="trigger-condition-row">
          <select name="condition_field"><option value="age" selected>Age</option></select>
          <select name="condition_operator"><option value="is_empty" selected>Is empty</option></select>
          <input name="condition_value" value="" disabled />
        </div>
        <div class="trigger-condition-row">
          <select name="condition_field"><option value="name" selected>Name</option></select>
          <select name="condition_operator"><option value="equals" selected>Equals</option></select>
          <input name="condition_value" value="Bob" />
        </div>
      </div>
    `;
    const ctx = createContext();
    const result = ctx.readConditionsFromEditor(document.getElementById('editor'));
    expect(result).toEqual({
      operator: 'OR',
      conditions: [{ field: 'age', operator: 'is_empty' }, { field: 'name', operator: 'equals', value: 'Bob' }],
    });
  });
});

describe('propertyEditorMethods.readNodeTriggerConditions', () => {
  it('delegates to readConditionsFromEditor scoped to the node-trigger editor', () => {
    document.body.innerHTML = `
      <div id="propertiesContent">
        <div class="conditions-editor" data-editor-kind="node-trigger">
          <select name="condition_group_operator"><option value="AND" selected>AND</option></select>
        </div>
      </div>
    `;
    const ctx = createContext();
    ctx.readConditionsFromEditor = vi.fn(() => '__RESULT__');

    const result = ctx.readNodeTriggerConditions(document.getElementById('propertiesContent'));

    expect(result).toBe('__RESULT__');
    expect(ctx.readConditionsFromEditor).toHaveBeenCalledWith(document.querySelector('.conditions-editor[data-editor-kind="node-trigger"]'));
  });
});

describe('propertyEditorMethods.readStageApprovalGroupsFromPanel', () => {
  it('keeps existing groups in their prior order and appends newly-selected ones', () => {
    document.body.innerHTML = `
      <select id="stage_groups_n1" multiple>
        <option value="2" selected>Beta</option>
        <option value="1" selected>Alpha</option>
        <option value="3" selected>Gamma</option>
      </select>
    `;
    const ctx = createContext();
    const existing = [{ id: 1, name: 'Alpha', position: 0 }, { id: 2, name: 'Beta', position: 1 }];

    const result = ctx.readStageApprovalGroupsFromPanel(document.body, 'n1', existing);

    expect(result).toEqual([
      { id: 1, name: 'Alpha', position: 0 },
      { id: 2, name: 'Beta', position: 1 },
      { id: 3, name: 'Gamma', position: 2 },
    ]);
  });

  it('drops groups that are no longer selected', () => {
    document.body.innerHTML = `
      <select id="stage_groups_n1" multiple>
        <option value="1" selected>Alpha</option>
      </select>
    `;
    const ctx = createContext();
    const existing = [{ id: 1, name: 'Alpha', position: 0 }, { id: 2, name: 'Beta', position: 1 }];

    expect(ctx.readStageApprovalGroupsFromPanel(document.body, 'n1', existing)).toEqual([
      { id: 1, name: 'Alpha', position: 0 },
    ]);
  });
});

describe('propertyEditorMethods.readStageApprovalFieldsFromPanel', () => {
  it('returns [] when the panel has no field selector for this node type', () => {
    document.body.innerHTML = '<div></div>';
    const ctx = createContext();
    expect(ctx.readStageApprovalFieldsFromPanel(document.body, 'n1')).toEqual([]);
  });

  it('maps selected options to full field records, looking them up by id', () => {
    document.body.innerHTML = `
      <select id="stage_fields_n1" multiple>
        <option value="9" selected>Requester</option>
      </select>
    `;
    const ctx = createContext({ fields: [{ id: 9, field_name: 'requester', field_label: 'Requester', field_type: 'text', order: 2 }] });

    expect(ctx.readStageApprovalFieldsFromPanel(document.body, 'n1')).toEqual([
      { id: 9, field_name: 'requester', field_label: 'Requester', field_type: 'text', order: 2 },
    ]);
  });

  it('falls back to the option text when the field is no longer in this.fields', () => {
    document.body.innerHTML = `
      <select id="stage_fields_n1" multiple>
        <option value="9" selected>Requester</option>
      </select>
    `;
    const ctx = createContext({ fields: [] });

    expect(ctx.readStageApprovalFieldsFromPanel(document.body, 'n1')).toEqual([
      { id: 9, field_name: 'Requester', field_label: 'Requester', field_type: '', order: 0 },
    ]);
  });
});

describe('propertyEditorMethods.moveStageApprovalGroup', () => {
  it('swaps a group with its neighbor and re-renders', () => {
    const node = { id: 'n1', data: { approval_groups: [{ id: 1, name: 'A', position: 0 }, { id: 2, name: 'B', position: 1 }] } };
    const ctx = createContext({ nodes: [node] });

    ctx.moveStageApprovalGroup('n1', 2, -1);

    expect(node.data.approval_groups.map((g) => g.id)).toEqual([2, 1]);
    expect(ctx.render).toHaveBeenCalled();
  });

  it('is a no-op past either end of the list', () => {
    const node = { id: 'n1', data: { approval_groups: [{ id: 1, name: 'A', position: 0 }, { id: 2, name: 'B', position: 1 }] } };
    const ctx = createContext({ nodes: [node] });

    ctx.moveStageApprovalGroup('n1', 1, -1);

    expect(node.data.approval_groups.map((g) => g.id)).toEqual([1, 2]);
    expect(ctx.render).not.toHaveBeenCalled();
  });
});

describe('propertyEditorMethods.readNotificationRulesFromPanel', () => {
  it('parses each rule card into a rule object', () => {
    document.body.innerHTML = `
      <div class="notification-rule-card" data-rule-id="4">
        <select name="notification_rule_stage"><option value="s1" selected>Stage 1</option></select>
        <select name="notification_rule_event"><option value="workflow_approved" selected>Approved</option></select>
        <input name="notification_rule_subject_template" value="Subj" />
        <input type="checkbox" name="notification_rule_notify_submitter" checked />
        <select name="notification_rule_email_field"><option value="" selected></option></select>
        <input name="notification_rule_static_emails" value="a@b.com" />
        <input type="checkbox" name="notification_rule_notify_stage_assignees" />
        <input type="checkbox" name="notification_rule_notify_stage_groups" />
        <select name="notification_rule_notify_groups" multiple></select>
      </div>
    `;
    const ctx = createContext();

    const rules = ctx.readNotificationRulesFromPanel(document.body);

    expect(rules).toEqual([{
      rule_id: 4, stage_node_id: 's1', event: 'workflow_approved', subject_template: 'Subj',
      notify_submitter: true, email_field: '', static_emails: 'a@b.com',
      notify_stage_assignees: false, notify_stage_groups: false, notify_groups: [], conditions: null,
    }]);
  });

  it('drops a card with no meaningful content set', () => {
    document.body.innerHTML = `
      <div class="notification-rule-card">
        <select name="notification_rule_stage"><option value="" selected></option></select>
        <select name="notification_rule_event"><option value="approval_request" selected>Approval</option></select>
        <input name="notification_rule_subject_template" value="" />
        <input type="checkbox" name="notification_rule_notify_submitter" />
        <select name="notification_rule_email_field"><option value="" selected></option></select>
        <input name="notification_rule_static_emails" value="" />
        <input type="checkbox" name="notification_rule_notify_stage_assignees" />
        <input type="checkbox" name="notification_rule_notify_stage_groups" />
        <select name="notification_rule_notify_groups" multiple></select>
      </div>
    `;
    const ctx = createContext();
    expect(ctx.readNotificationRulesFromPanel(document.body)).toEqual([]);
  });
});

describe('propertyEditorMethods.addNotificationRule', () => {
  it('appends a default rule and re-renders', () => {
    const node = { id: 'n1', data: { notification_rules: [] } };
    const ctx = createContext({ nodes: [node] });

    ctx.addNotificationRule('n1');

    expect(node.data.notification_rules).toHaveLength(1);
    expect(ctx.render).toHaveBeenCalled();
    expect(ctx.selectNode).toHaveBeenCalledWith('n1');
  });
});

describe('propertyEditorMethods.removeNotificationRule', () => {
  it('removes the rule at the given index', () => {
    const node = { id: 'n1', data: { notification_rules: [{ event: 'a' }, { event: 'b' }] } };
    const ctx = createContext({ nodes: [node] });

    ctx.removeNotificationRule('n1', 0);

    expect(node.data.notification_rules).toEqual([{ event: 'b' }]);
  });
});

describe('propertyEditorMethods.addNotificationRuleCondition', () => {
  it('adds an empty condition to the given rule', () => {
    const node = { id: 'n1', data: { notification_rules: [{ conditions: null }] } };
    const ctx = createContext({ nodes: [node] });

    ctx.addNotificationRuleCondition('n1', 0);

    expect(node.data.notification_rules[0].conditions).toEqual({
      operator: 'AND', conditions: [{ field: '', operator: 'equals', value: '' }],
    });
  });
});

describe('propertyEditorMethods.removeNotificationRuleCondition', () => {
  it('removes the condition and nulls conditions out once empty', () => {
    const node = {
      id: 'n1',
      data: { notification_rules: [{ conditions: { operator: 'AND', conditions: [{ field: 'a', operator: 'equals', value: '1' }] } }] },
    };
    const ctx = createContext({ nodes: [node] });

    ctx.removeNotificationRuleCondition('n1', 0, 0);

    expect(node.data.notification_rules[0].conditions).toBeNull();
  });
});

describe('propertyEditorMethods.updateNotificationRules', () => {
  it('reads the panel back onto node.data.notification_rules', () => {
    document.body.innerHTML = '<div id="propertiesContent"></div>';
    const node = { id: 'n1', data: {} };
    const ctx = createContext({ nodes: [node] });
    ctx.readNotificationRulesFromPanel = vi.fn(() => ['__RULES__']);

    ctx.updateNotificationRules('n1');

    expect(node.data.notification_rules).toEqual(['__RULES__']);
    expect(ctx.render).toHaveBeenCalled();
  });
});

describe('propertyEditorMethods.addTriggerCondition', () => {
  it('appends an empty condition to node.data.trigger_conditions', () => {
    const node = { id: 'n1', data: { trigger_conditions: null } };
    const ctx = createContext({ nodes: [node] });

    ctx.addTriggerCondition('n1');

    expect(node.data.trigger_conditions).toEqual({ operator: 'AND', conditions: [{ field: '', operator: 'equals', value: '' }] });
  });
});

describe('propertyEditorMethods.removeTriggerCondition', () => {
  it('nulls trigger_conditions out once the last condition is removed', () => {
    const node = { id: 'n1', data: { trigger_conditions: { operator: 'AND', conditions: [{ field: 'a', operator: 'equals', value: '1' }] } } };
    const ctx = createContext({ nodes: [node] });

    ctx.removeTriggerCondition('n1', 0);

    expect(node.data.trigger_conditions).toBeNull();
  });
});

describe('propertyEditorMethods.updateNodeTriggerConditions', () => {
  it('reads the panel back onto node.data.trigger_conditions', () => {
    document.body.innerHTML = '<div id="propertiesContent"></div>';
    const node = { id: 'n1', data: {} };
    const ctx = createContext({ nodes: [node] });
    ctx.readNodeTriggerConditions = vi.fn(() => '__CONDITIONS__');

    ctx.updateNodeTriggerConditions('n1');

    expect(node.data.trigger_conditions).toBe('__CONDITIONS__');
  });
});

describe('propertyEditorMethods.updateActionConfig', () => {
  it('reads name/action_type/trigger/config back onto node.data', () => {
    document.body.innerHTML = `
      <div id="propertiesContent">
        <input name="name" value="Sync LDAP" />
        <select name="action_type"><option value="ldap" selected>LDAP Update</option></select>
        <select name="trigger"><option value="on_approve" selected>On Approval</option></select>
        <textarea name="config">{"a":1}</textarea>
      </div>
    `;
    const node = { id: 'n1', data: {} };
    const ctx = createContext({ nodes: [node] });

    ctx.updateActionConfig('n1');

    expect(node.data).toMatchObject({ name: 'Sync LDAP', action_type: 'ldap', trigger: 'on_approve', config: '{"a":1}' });
    expect(ctx.render).toHaveBeenCalled();
  });
});

describe('propertyEditorMethods.updateEmailConfig', () => {
  it('reads every email field back onto node.data', () => {
    document.body.innerHTML = `
      <div id="propertiesContent">
        <input name="name" value="Notify Approver" />
        <input name="email_to" value="a@b.com" />
        <select name="email_to_field"><option value="requester" selected>Requester</option></select>
        <input name="email_cc" value="c@d.com" />
        <select name="email_cc_field"><option value="" selected></option></select>
        <input name="email_subject_template" value="Approved" />
        <textarea name="email_body_template">Body</textarea>
        <input name="email_template_name" value="emails/approval.html" />
        <select name="trigger"><option value="on_complete" selected>On Complete</option></select>
      </div>
    `;
    const node = { id: 'n1', data: {} };
    const ctx = createContext({ nodes: [node] });

    ctx.updateEmailConfig('n1');

    expect(node.data).toEqual({
      name: 'Notify Approver', email_to: 'a@b.com', email_to_field: 'requester',
      email_cc: 'c@d.com', email_cc_field: '', email_subject_template: 'Approved',
      email_body_template: 'Body', email_template_name: 'emails/approval.html', trigger: 'on_complete',
    });
    expect(ctx.render).toHaveBeenCalled();
    expect(ctx.selectNode).toHaveBeenCalledWith('n1');
  });
});
