/**
 * Property editor for the Workflow Builder: the node-properties panel -
 * build/update/read/add/remove/move handlers for every node type's
 * property tab (form/stage/approval/condition/action/email/sub_workflow/
 * end/workflow_settings), plus notification-rule and trigger-condition
 * sub-editors, and the empty/select-a-node placeholder state.
 *
 * Mixed onto WorkflowBuilder.prototype in workflow-builder.js
 * (Object.assign), not a standalone class of its own - these methods read
 * this.nodes/this.connections/this.fields/this.groups/this.forms/
 * this.workflowTargets directly, plus call back into
 * escapeHtml()/getNodeTypeLabel()/buildNodeIssuesAlert()/
 * buildPropertySection()/render()/refreshValidationState()/selectNode(),
 * which still live on the single WorkflowBuilder instance. Mirrors
 * form-builder-property-editor.js's shape/scope.
 */
export const propertyEditorMethods = {
    showNodeProperties(node) {
        const content = document.getElementById('propertiesContent');
        content.innerHTML = this.buildPropertiesForm(node);

        // Add event listeners for property changes
        content.querySelectorAll('input, select, textarea').forEach(input => {
            input.addEventListener('change', (e) => {
                let value = e.target.value;
                if (e.target.type === 'checkbox') {
                    value = e.target.checked;
                }
                this.updateNodeProperty(node.id, e.target.name, value);
            });
        });
    },

    showEmptyProperties() {
        const content = document.getElementById('propertiesContent');
        content.innerHTML = `
            <div class="properties-empty">
                <i class="bi bi-info-circle properties-empty-icon"></i>
                <p>Select a node to edit its properties</p>
            </div>
        `;
    },

    buildPropertiesForm(node) {
        let html = `<h6 class="mb-3">${this.escapeHtml(this.getNodeTypeLabel(node.type))}</h6>`;
        html += this.buildNodeIssuesAlert(node);

        switch (node.type) {
            case 'start':
                html += '<p class="text-muted">This is the workflow start point.</p>';
                break;

            case 'form':
                html += this.buildFormProperties(node);
                break;

            case 'workflow_settings':
                html += this.buildWorkflowSettingsProperties(node);
                break;

            case 'stage':
                html += this.buildStageProperties(node);
                break;


            case 'approval':
                html += this.buildApprovalProperties(node);
                break;

            case 'condition':
                html += this.buildConditionProperties(node);
                break;

            case 'action':
                html += this.buildActionProperties(node);
                break;

            case 'email':
                html += this.buildEmailProperties(node);
                break;

            case 'sub_workflow':
                html += this.buildSubWorkflowProperties(node);
                break;

            case 'join':
                html += '<div class="alert alert-secondary"><i class="bi bi-info-circle"></i> This join node automatically merges parallel approval stages. It cannot be edited or removed independently.</div>';
                break;

            case 'end':
                html += this.buildEndProperties(node);
                break;
        }

        return html;
    },

    buildStageProperties(node) {
        const data = node.data || {};
        const orderedApprovalGroups = this.getNormalizedStageApprovalGroups(data.approval_groups || []);
        const selectedGroupIds = orderedApprovalGroups.map(g => g.id);
        const selectedApprovalFieldIds = new Set((data.approval_fields || []).map(field => field.id));

        const basicsSection = `
            <div class="mb-3">
                <label class="form-label"><strong>Stage Name</strong></label>
                <input type="text" class="form-control" name="name"
                       value="${this.escapeHtml(data.name || '')}"
                       onchange="workflowBuilder.updateStageConfig('${node.id}')" />
            </div>

            <div class="mb-3">
                <label class="form-label"><strong>Order</strong></label>
                <input type="number" class="form-control" name="order" min="1"
                       value="${this.escapeHtml(String(data.order || 1))}"
                       onchange="workflowBuilder.updateStageConfig('${node.id}')" />
                <small class="text-muted">Stages with the same order number run in parallel (fork/join).</small>
            </div>

            <div class="mb-3">
                <label class="form-label"><strong>Approve Button Label</strong></label>
                <input type="text" class="form-control" name="approve_label"
                       value="${this.escapeHtml(data.approve_label || '')}"
                       placeholder="Approve"
                       onchange="workflowBuilder.updateStageConfig('${node.id}')" />
                <small class="text-muted">Custom label for the approve button (e.g. "Sign Off")</small>
            </div>

            <div class="mb-3">
                <div class="form-check form-switch">
                    <input class="form-check-input" type="checkbox" id="stage_requires_manager_${node.id}"
                           name="requires_manager_approval" ${data.requires_manager_approval ? 'checked' : ''}
                           onchange="workflowBuilder.updateStageConfig('${node.id}')">
                    <label class="form-check-label" for="stage_requires_manager_${node.id}">
                        <i class="bi bi-person-badge"></i> <strong>Require Manager Approval</strong>
                    </label>
                </div>
            </div>

            <div class="mb-3">
                <div class="form-check form-switch">
                    <input class="form-check-input" type="checkbox" id="stage_allow_send_back_${node.id}"
                           name="allow_send_back" ${data.allow_send_back ? 'checked' : ''}
                           onchange="workflowBuilder.updateStageConfig('${node.id}')">
                    <label class="form-check-label" for="stage_allow_send_back_${node.id}">
                        <i class="bi bi-arrow-return-left"></i> <strong>Allow Send Back to This Stage</strong>
                    </label>
                </div>
                <small class="text-muted">Later stages can return submissions here for correction without rejecting the workflow.</small>
            </div>

            <div class="mb-3">
                <div class="form-check form-switch">
                    <input class="form-check-input" type="checkbox" id="stage_allow_reassign_${node.id}"
                           name="allow_reassign" ${data.allow_reassign ? 'checked' : ''}
                           onchange="workflowBuilder.updateStageConfig('${node.id}')">
                    <label class="form-check-label" for="stage_allow_reassign_${node.id}">
                        <i class="bi bi-arrow-left-right"></i> <strong>Allow Reassignment</strong>
                    </label>
                </div>
                <small class="text-muted">Allow current reviewers to reassign tasks to another eligible member of the stage groups.</small>
            </div>

            <div class="mb-3">
                <div class="form-check form-switch">
                    <input class="form-check-input" type="checkbox" id="stage_allow_edit_form_data_${node.id}"
                           name="allow_edit_form_data" ${data.allow_edit_form_data ? 'checked' : ''}
                           onchange="workflowBuilder.updateStageConfig('${node.id}')">
                    <label class="form-check-label" for="stage_allow_edit_form_data_${node.id}">
                        <i class="bi bi-pencil-square"></i> <strong>Allow Reviewer Edits</strong>
                    </label>
                </div>
                <small class="text-muted">Approvers at this stage may edit the original submission while reviewing it.</small>
            </div>
        `;

        let routingSection = `
            <div class="mb-3">
                <label class="form-label"><i class="bi bi-people"></i> <strong>Approval Groups</strong></label>
                <select class="form-select builder-multiselect-lg" id="stage_groups_${node.id}" name="approval_groups" multiple size="6"
                        onchange="workflowBuilder.updateStageConfig('${node.id}')">
        `;

        this.groups.forEach(group => {
            const selected = selectedGroupIds.includes(group.id) ? 'selected' : '';
            routingSection += `<option value="${this.escapeHtml(String(group.id))}" ${selected}>${this.escapeHtml(group.name)}</option>`;
        });

        routingSection += `
                </select>
                <small class="text-muted d-block mt-1">Hold Ctrl/Cmd to select multiple groups.</small>
            </div>

            ${this.buildStageApprovalOrderEditor(node, orderedApprovalGroups)}

            <div class="mb-3">
                <label class="form-label">Approval Logic</label>
                <select class="form-select" name="approval_logic"
                        onchange="workflowBuilder.updateStageConfig('${node.id}')">
                    <option value="any" ${data.approval_logic === 'any' ? 'selected' : ''}>Any (OR)</option>
                    <option value="all" ${data.approval_logic === 'all' ? 'selected' : ''}>All (AND)</option>
                    <option value="sequence" ${data.approval_logic === 'sequence' ? 'selected' : ''}>Sequential</option>
                </select>
            </div>
        `;

        const approvalFieldsSection = `
            <div class="mb-3">
                <label class="form-label"><strong>Fields shown during this stage</strong></label>
                <select class="form-select builder-multiselect-lg" id="stage_fields_${node.id}" name="approval_fields" multiple size="6"
                        onchange="workflowBuilder.updateStageConfig('${node.id}')">
                    ${this.fields.map(field => `
                        <option value="${this.escapeHtml(String(field.id))}" ${selectedApprovalFieldIds.has(field.id) ? 'selected' : ''}>${this.escapeHtml(field.field_label)} (${this.escapeHtml(field.field_name)})</option>
                    `).join('')}
                </select>
                <small class="text-muted d-block mt-1">Selected fields become editable approval-step fields for this stage only.</small>
            </div>
        `;

        const assigneeSection = `
            <div class="mb-3">
                <label class="form-label"><strong>Assignee Field</strong></label>
                <select class="form-select" name="assignee_form_field"
                        onchange="workflowBuilder.updateStageConfig('${node.id}')">
                    <option value="">-- Use approval groups --</option>
                    ${this.fields.map(f => `
                        <option value="${this.escapeHtml(f.field_name)}" ${data.assignee_form_field === f.field_name ? 'selected' : ''}>${this.escapeHtml(f.field_label)} (${this.escapeHtml(f.field_name)})</option>
                    `).join('')}
                </select>
                <small class="text-muted">When selected, the stage resolves the approver from a submitted form field before falling back to approval groups.</small>
            </div>

            <div class="mb-3">
                <label class="form-label"><strong>Lookup Type</strong></label>
                <select class="form-select" name="assignee_lookup_type"
                        onchange="workflowBuilder.updateStageConfig('${node.id}')">
                    <option value="email" ${data.assignee_lookup_type === 'email' ? 'selected' : ''}>Email address</option>
                    <option value="username" ${data.assignee_lookup_type === 'username' ? 'selected' : ''}>Username</option>
                    <option value="full_name" ${data.assignee_lookup_type === 'full_name' ? 'selected' : ''}>Full name</option>
                    <option value="ldap" ${data.assignee_lookup_type === 'ldap' ? 'selected' : ''}>LDAP display name</option>
                </select>
            </div>

            <div class="mb-3">
                <div class="form-check form-switch">
                    <input class="form-check-input" type="checkbox" id="stage_validate_assignee_group_${node.id}"
                           name="validate_assignee_group" ${data.validate_assignee_group !== false ? 'checked' : ''}
                           onchange="workflowBuilder.updateStageConfig('${node.id}')">
                    <label class="form-check-label" for="stage_validate_assignee_group_${node.id}">
                        <strong>Require Assignee to Belong to Stage Groups</strong>
                    </label>
                </div>
            </div>
        `;

        return `
            <div class="alert alert-info">
                <i class="bi bi-info-circle"></i> Configure an approval stage with its own groups and logic.
            </div>
            ${this.buildPropertySection('Stage Basics', basicsSection, {
                icon: 'diagram-3',
                description: 'Set the stage name, order, button label, and reviewer capabilities.',
            })}
            ${this.buildPropertySection('Approver Routing', routingSection, {
                icon: 'people',
                description: 'Choose which groups approve and whether they act together, separately, or in sequence.',
            })}
            ${this.buildPropertySection('Approval-Only Fields', approvalFieldsSection, {
                icon: 'ui-checks-grid',
                description: 'Limit extra editable fields to this approval step.',
            })}
            ${this.buildPropertySection('Dynamic Assignee', assigneeSection, {
                icon: 'person-badge',
                description: 'Resolve approvers from submitted form data when needed.',
            })}
            ${this.buildTriggerConditionsEditor(node, 'Stage trigger conditions')}
        `;
    },

    getNormalizedStageApprovalGroups(groups) {
        return [...(groups || [])]
            .filter(group => group && group.id)
            .sort((a, b) => {
                const posA = a.position ?? 0;
                const posB = b.position ?? 0;
                if (posA !== posB) return posA - posB;
                return (a.name || '').localeCompare(b.name || '');
            })
            .map((group, index) => ({ ...group, position: index }));
    },

    buildStageApprovalOrderEditor(node, orderedGroups) {
        if (!orderedGroups.length) {
            return `
                <div class="alert alert-secondary small">
                    Select one or more approval groups above. For sequential stages, the order shown here controls which group is asked first.
                </div>
            `;
        }

        return `
            <div class="mb-3">
                <label class="form-label"><strong>Approval Group Order</strong></label>
                <div class="list-group">
                    ${orderedGroups.map((group, index) => `
                        <div class="list-group-item d-flex justify-content-between align-items-center py-2">
                            <div>
                                <span class="badge bg-secondary me-2">${index + 1}</span>
                                ${this.escapeHtml(group.name)}
                            </div>
                            <div class="btn-group btn-group-sm" role="group">
                                <button type="button" class="btn btn-outline-secondary" ${index === 0 ? 'disabled' : ''}
                                        onclick="workflowBuilder.moveStageApprovalGroup('${node.id}', ${group.id}, -1)">
                                    <i class="bi bi-arrow-up"></i>
                                </button>
                                <button type="button" class="btn btn-outline-secondary" ${index === orderedGroups.length - 1 ? 'disabled' : ''}
                                        onclick="workflowBuilder.moveStageApprovalGroup('${node.id}', ${group.id}, 1)">
                                    <i class="bi bi-arrow-down"></i>
                                </button>
                            </div>
                        </div>
                    `).join('')}
                </div>
                <small class="text-muted d-block mt-1">This order is used when the stage logic is <strong>Sequential</strong>.</small>
            </div>
        `;
    },

    buildWorkflowSettingsProperties(node) {
        const data = node.data || {};

        const basicsSection = `
            <div class="mb-3">
                <label class="form-label">Workflow Track Label</label>
                <input type="text" class="form-control" name="name_label"
                       value="${this.escapeHtml(data.name_label || '')}"
                       placeholder="e.g. Finance Approval"
                       onchange="workflowBuilder.updateWorkflowSettings('${node.id}')" />
                <small class="text-muted">Helpful when a form has multiple workflow tracks.</small>
            </div>
        `;

        const timingSection = `
            <div class="mb-3">
                <label class="form-label">Approval Deadline (days)</label>
                <input type="number" class="form-control" name="approval_deadline_days" min="1"
                       value="${this.escapeHtml(String(data.approval_deadline_days || ''))}" placeholder="No deadline"
                       onchange="workflowBuilder.updateWorkflowSettings('${node.id}')" />
            </div>
            <div class="mb-3">
                <label class="form-label">Send Reminder After (days)</label>
                <input type="number" class="form-control" name="send_reminder_after_days" min="1"
                       value="${this.escapeHtml(String(data.send_reminder_after_days || ''))}" placeholder="No reminder"
                       onchange="workflowBuilder.updateWorkflowSettings('${node.id}')" />
            </div>
            <div class="mb-3">
                <label class="form-label">Auto-Approve After (days)</label>
                <input type="number" class="form-control" name="auto_approve_after_days" min="1"
                       value="${this.escapeHtml(String(data.auto_approve_after_days || ''))}" placeholder="Never"
                       onchange="workflowBuilder.updateWorkflowSettings('${node.id}')" />
            </div>
            <div class="mb-3">
                <label class="form-label">Notification Cadence</label>
                <select class="form-select" name="notification_cadence"
                        onchange="workflowBuilder.updateWorkflowSettings('${node.id}')">
                    <option value="immediate" ${data.notification_cadence === 'immediate' ? 'selected' : ''}>Immediate</option>
                    <option value="daily" ${data.notification_cadence === 'daily' ? 'selected' : ''}>Daily Digest</option>
                    <option value="weekly" ${data.notification_cadence === 'weekly' ? 'selected' : ''}>Weekly Digest</option>
                    <option value="monthly" ${data.notification_cadence === 'monthly' ? 'selected' : ''}>Monthly Digest</option>
                    <option value="form_field_date" ${data.notification_cadence === 'form_field_date' ? 'selected' : ''}>On Date From Form Field</option>
                </select>
            </div>

            <div class="mb-3">
                <label class="form-label">Digest Day</label>
                <input type="number" class="form-control" name="notification_cadence_day" min="0" max="31"
                       value="${this.escapeHtml(String(data.notification_cadence_day || ''))}" placeholder="Weekly: 0-6, Monthly: 1-31"
                       onchange="workflowBuilder.updateWorkflowSettings('${node.id}')" />
                <small class="text-muted">Used for weekly and monthly cadences only.</small>
            </div>

            <div class="mb-3">
                <label class="form-label">Digest Time</label>
                <input type="time" class="form-control" name="notification_cadence_time"
                       value="${this.escapeHtml(data.notification_cadence_time || '')}"
                       onchange="workflowBuilder.updateWorkflowSettings('${node.id}')" />
            </div>

            <div class="mb-3">
                <label class="form-label">Date Field</label>
                <select class="form-select" name="notification_cadence_form_field"
                        onchange="workflowBuilder.updateWorkflowSettings('${node.id}')">
                    <option value="">-- Select a date field --</option>
                    ${this.fields.map(f => `
                        <option value="${this.escapeHtml(f.field_name)}" ${data.notification_cadence_form_field === f.field_name ? 'selected' : ''}>${this.escapeHtml(f.field_label)} (${this.escapeHtml(f.field_name)})</option>
                    `).join('')}
                </select>
                <small class="text-muted">Used only when cadence is “On Date From Form Field”.</small>
            </div>
        `;

        return `
            <div class="alert alert-info">
                <i class="bi bi-info-circle"></i> Workflow-level notification and deadline settings.
            </div>
            ${this.buildPropertySection('Workflow Identity', basicsSection, {
                icon: 'signpost-split',
                description: 'Label this track so admins can tell multiple workflow paths apart.',
            })}
            ${this.buildPropertySection('Timing, Deadlines & Notifications', timingSection, {
                icon: 'clock-history',
                description: 'Control deadlines, reminders, digests, and date-driven notifications.',
            })}
            ${this.buildNotificationRulesEditor(node)}
            ${this.buildTriggerConditionsEditor(node, 'Workflow trigger conditions')}
        `;
    },

    getNotificationRuleStageOptions() {
        return this.nodes
            .filter(node => node.type === 'stage')
            .map(node => ({
                nodeId: node.id,
                stageId: node.data?.stage_id || null,
                name: node.data?.name || 'Unnamed Stage',
                order: node.data?.order || 0,
            }))
            .sort((a, b) => (a.order - b.order) || a.name.localeCompare(b.name));
    },

    getNotificationRuleState(rule) {
        return {
            rule_id: rule?.rule_id || null,
            stage_id: rule?.stage_id || null,
            stage_node_id: rule?.stage_node_id || '',
            event: rule?.event || 'approval_request',
            subject_template: rule?.subject_template || '',
            notify_submitter: !!rule?.notify_submitter,
            email_field: rule?.email_field || '',
            static_emails: rule?.static_emails || '',
            notify_stage_assignees: !!rule?.notify_stage_assignees,
            notify_stage_groups: !!rule?.notify_stage_groups,
            notify_groups: (rule?.notify_groups || []).map(group => ({
                id: typeof group === 'object' ? group.id : group,
                name: typeof group === 'object' ? group.name : String(group),
            })).filter(group => group.id),
            conditions: rule?.conditions || null,
        };
    },

    buildNotificationRulesEditor(node) {
        const rules = (node.data.notification_rules || []).map(rule => this.getNotificationRuleState(rule));
        const stageOptions = this.getNotificationRuleStageOptions();
        const eventOptions = [
            ['submission_received', 'Submission Received'],
            ['approval_request', 'Approval Request'],
            ['stage_decision', 'Stage Decision'],
            ['workflow_approved', 'Workflow Approved'],
            ['workflow_denied', 'Workflow Denied'],
            ['form_withdrawn', 'Form Withdrawn'],
        ];

        const content = `
            ${(rules.length ? rules : [null]).map((rule, index) => {
                const state = this.getNotificationRuleState(rule || {});
                const selectedGroupIds = new Set((state.notify_groups || []).map(group => group.id));
                return `
                    <div class="card mb-3 notification-rule-card" data-rule-index="${index}" data-rule-id="${this.escapeHtml(String(state.rule_id || ''))}">
                        <div class="card-body py-3">
                            <div class="d-flex justify-content-between align-items-center mb-2">
                                <h6 class="mb-0">Rule ${index + 1}</h6>
                                ${rules.length ? `
                                    <button type="button" class="btn btn-sm btn-outline-danger"
                                            onclick="workflowBuilder.removeNotificationRule('${node.id}', ${index})">
                                        Remove
                                    </button>
                                ` : ''}
                            </div>
                            <div class="mb-3">
                                <label class="form-label form-label-sm">Scope</label>
                                <select class="form-select form-select-sm" name="notification_rule_stage"
                                        onchange="workflowBuilder.updateNotificationRules('${node.id}')">
                                    <option value="">Workflow-level</option>
                                    ${stageOptions.map(option => `
                                        <option value="${option.nodeId}" ${state.stage_node_id === option.nodeId ? 'selected' : ''}>Stage ${this.escapeHtml(String(option.order))}: ${this.escapeHtml(option.name)}</option>
                                    `).join('')}
                                </select>
                            </div>
                            <div class="mb-3">
                                <label class="form-label form-label-sm">Event</label>
                                <select class="form-select form-select-sm" name="notification_rule_event"
                                        onchange="workflowBuilder.updateNotificationRules('${node.id}')">
                                    ${eventOptions.map(([value, label]) => `
                                        <option value="${value}" ${state.event === value ? 'selected' : ''}>${label}</option>
                                    `).join('')}
                                </select>
                            </div>
                            <div class="mb-3">
                                <label class="form-label form-label-sm">Subject Template</label>
                                <input type="text" class="form-control form-control-sm" name="notification_rule_subject_template"
                                       value="${this.escapeHtml(state.subject_template)}"
                                       placeholder="Submission Approved: {form_name} (ID {submission_id})"
                                       onchange="workflowBuilder.updateNotificationRules('${node.id}')" />
                            </div>
                            <div class="mb-3">
                                <label class="form-label form-label-sm">Email Field</label>
                                <select class="form-select form-select-sm" name="notification_rule_email_field"
                                        onchange="workflowBuilder.updateNotificationRules('${node.id}')">
                                    <option value="">-- None --</option>
                                    ${this.fields.map(field => `
                                        <option value="${this.escapeHtml(field.field_name)}" ${state.email_field === field.field_name ? 'selected' : ''}>${this.escapeHtml(field.field_label)} (${this.escapeHtml(field.field_name)})</option>
                                    `).join('')}
                                </select>
                            </div>
                            <div class="mb-3">
                                <label class="form-label form-label-sm">Static Emails</label>
                                <input type="text" class="form-control form-control-sm" name="notification_rule_static_emails"
                                       value="${this.escapeHtml(state.static_emails)}"
                                       placeholder="ops@example.com, owner@example.com"
                                       onchange="workflowBuilder.updateNotificationRules('${node.id}')" />
                            </div>
                            <div class="mb-3">
                                <label class="form-label form-label-sm">Additional Groups</label>
                                <select class="form-select form-select-sm" name="notification_rule_notify_groups" multiple size="4"
                                        onchange="workflowBuilder.updateNotificationRules('${node.id}')">
                                    ${this.groups.map(group => `
                                        <option value="${this.escapeHtml(String(group.id))}" ${selectedGroupIds.has(group.id) ? 'selected' : ''}>${this.escapeHtml(group.name)}</option>
                                    `).join('')}
                                </select>
                            </div>
                            <div class="row g-2 mb-3">
                                <div class="col-12 col-md-6">
                                    <div class="form-check form-switch">
                                        <input class="form-check-input" type="checkbox" name="notification_rule_notify_submitter"
                                               ${state.notify_submitter ? 'checked' : ''}
                                               onchange="workflowBuilder.updateNotificationRules('${node.id}')">
                                        <label class="form-check-label">Notify submitter</label>
                                    </div>
                                </div>
                                <div class="col-12 col-md-6">
                                    <div class="form-check form-switch">
                                        <input class="form-check-input" type="checkbox" name="notification_rule_notify_stage_assignees"
                                               ${state.notify_stage_assignees ? 'checked' : ''}
                                               onchange="workflowBuilder.updateNotificationRules('${node.id}')">
                                        <label class="form-check-label">Notify stage assignees</label>
                                    </div>
                                </div>
                                <div class="col-12 col-md-6">
                                    <div class="form-check form-switch">
                                        <input class="form-check-input" type="checkbox" name="notification_rule_notify_stage_groups"
                                               ${state.notify_stage_groups ? 'checked' : ''}
                                               onchange="workflowBuilder.updateNotificationRules('${node.id}')">
                                        <label class="form-check-label">Notify stage groups</label>
                                    </div>
                                </div>
                            </div>
                            ${this.buildConditionsEditor({
                                title: 'Rule conditions',
                                conditions: state.conditions,
                                onChangeHandler: `workflowBuilder.updateNotificationRules('${node.id}')`,
                                editorKind: 'notification-rule',
                                extraAttributes: `data-rule-index="${index}"`,
                                removeConditionHandler: `workflowBuilder.removeNotificationRuleCondition('${node.id}', ${index}, __INDEX__)`,
                            })}
                            <button type="button" class="btn btn-sm btn-outline-primary"
                                    onclick="workflowBuilder.addNotificationRuleCondition('${node.id}', ${index})">
                                <i class="bi bi-plus-lg"></i> Add Rule Condition
                            </button>
                        </div>
                    </div>
                `;
            }).join('')}
            <button type="button" class="btn btn-sm btn-outline-primary" onclick="workflowBuilder.addNotificationRule('${node.id}')">
                <i class="bi bi-plus-lg"></i> Add Notification Rule
            </button>
        `;

        return this.buildPropertySection('Notification Rules', content, {
            icon: 'bell',
            description: 'Configure event-driven recipients here instead of dropping to Django Admin.',
        });
    },

    getNormalizedTriggerConditions(rawConditions) {
        if (!rawConditions) {
            return { operator: 'AND', conditions: [] };
        }

        if (Array.isArray(rawConditions.conditions)) {
            return {
                operator: (rawConditions.operator || 'AND').toUpperCase() === 'OR' ? 'OR' : 'AND',
                conditions: rawConditions.conditions.map(condition => ({
                    field: condition.field || '',
                    operator: condition.operator || 'equals',
                    value: condition.value ?? ''
                }))
            };
        }

        if (rawConditions.field) {
            return {
                operator: 'AND',
                conditions: [{
                    field: rawConditions.field || '',
                    operator: rawConditions.operator || 'equals',
                    value: rawConditions.value ?? ''
                }]
            };
        }

        return { operator: 'AND', conditions: [] };
    },

    buildConditionsEditor({ title, conditions, onChangeHandler, editorKind, extraAttributes = '', removeConditionHandler = null, showHeader = true }) {
        const state = this.getNormalizedTriggerConditions(conditions);
        const operatorOptions = [
            ['equals', 'Equals'],
            ['not_equals', 'Not equals'],
            ['contains', 'Contains'],
            ['in', 'In list'],
            ['gt', 'Greater than'],
            ['gte', 'Greater than or equal'],
            ['lt', 'Less than'],
            ['lte', 'Less than or equal'],
            ['is_empty', 'Is empty'],
            ['not_empty', 'Is not empty'],
        ];

        let rowsHtml = '';
        state.conditions.forEach((condition, index) => {
            const operator = condition.operator || 'equals';
            const needsValue = !['is_empty', 'not_empty'].includes(operator);
            rowsHtml += `
                <div class="border rounded p-2 mb-2 trigger-condition-row" data-index="${index}">
                    <div class="mb-2">
                        <label class="form-label form-label-sm mb-1">Field</label>
                        <select class="form-select form-select-sm" name="condition_field"
                                onchange="${onChangeHandler}">
                            <option value="">-- Select field --</option>
                            ${this.fields.map(field => `
                                <option value="${this.escapeHtml(field.field_name)}" ${condition.field === field.field_name ? 'selected' : ''}>${this.escapeHtml(field.field_label)} (${this.escapeHtml(field.field_name)})</option>
                            `).join('')}
                        </select>
                    </div>
                    <div class="mb-2">
                        <label class="form-label form-label-sm mb-1">Operator</label>
                        <select class="form-select form-select-sm" name="condition_operator"
                                onchange="${onChangeHandler}">
                            ${operatorOptions.map(([value, label]) => `
                                <option value="${value}" ${operator === value ? 'selected' : ''}>${label}</option>
                            `).join('')}
                        </select>
                    </div>
                    <div class="mb-2">
                        <label class="form-label form-label-sm mb-1">Value</label>
                        <input type="text" class="form-control form-control-sm" name="condition_value"
                               value="${this.escapeHtml(condition.value ?? '')}"
                               placeholder="${operator === 'in' ? 'Comma-separated values' : 'Comparison value'}"
                               ${needsValue ? '' : 'disabled'}
                               onchange="${onChangeHandler}" />
                    </div>
                    ${removeConditionHandler ? `
                    <div class="text-end">
                        <button type="button" class="btn btn-sm btn-outline-danger"
                                onclick="${removeConditionHandler.replace('__INDEX__', String(index))}">
                            Remove
                        </button>
                    </div>
                    ` : ''}
                </div>
            `;
        });

        if (!rowsHtml) {
            rowsHtml = '<p class="text-muted small mb-2">Always run unless you add at least one condition.</p>';
        }

        return `
            ${showHeader ? `<hr /><h6>${this.escapeHtml(title)}</h6>` : ''}
            <div class="conditions-editor" data-editor-kind="${editorKind}" ${extraAttributes}>
            <div class="mb-2">
                <label class="form-label form-label-sm">Match mode</label>
                <select class="form-select form-select-sm" name="condition_group_operator"
                        onchange="${onChangeHandler}">
                    <option value="AND" ${state.operator === 'AND' ? 'selected' : ''}>All conditions must match (AND)</option>
                    <option value="OR" ${state.operator === 'OR' ? 'selected' : ''}>Any condition may match (OR)</option>
                </select>
            </div>
            ${rowsHtml}
            </div>
        `;
    },

    buildTriggerConditionsEditor(node, title) {
        const content = `
            ${this.buildConditionsEditor({
                title,
                conditions: node.data.trigger_conditions,
                onChangeHandler: `workflowBuilder.updateNodeTriggerConditions('${node.id}')`,
                editorKind: 'node-trigger',
                removeConditionHandler: `workflowBuilder.removeTriggerCondition('${node.id}', __INDEX__)`,
                showHeader: false,
            })}
            <button type="button" class="btn btn-sm btn-outline-primary"
                    onclick="workflowBuilder.addTriggerCondition('${node.id}')">
                <i class="bi bi-plus-lg"></i> Add Condition
            </button>
        `;

        return this.buildPropertySection(title, content, {
            icon: 'funnel',
            description: 'Only apply this node when the submitted data matches these conditions.',
        });
    },

    buildFormProperties(node) {
        const data = node.data || {};
        const fields = data.fields || [];
        const hasMoreFields = data.has_more_fields || false;
        const isInitial = data.is_initial !== false;  // Initial form node (default true for backward compatibility)

        let html = `
            <div class="alert alert-info">
                <i class="bi bi-info-circle"></i> This node represents ${isInitial ? 'the initial form' : 'an additional form'} that users fill out and submit.
            </div>
        `;

        // For additional form nodes, show form selector
        if (!isInitial) {
            html += `
                <div class="mb-3">
                    <label class="form-label"><i class="bi bi-file-earmark-text"></i> <strong>Select Form</strong></label>
                    <select class="form-select" name="form_id" onchange="workflowBuilder.updateFormSelection('${node.id}', this.value)">
                        <option value="">-- Select a form --</option>
            `;

            this.forms.forEach(form => {
                const selected = data.form_id == form.id ? 'selected' : '';
                html += `<option value="${form.id}" ${selected}>${this.escapeHtml(form.name)} (${this.escapeHtml(String(form.field_count))} fields)</option>`;
            });

            html += `
                    </select>
                    <small class="form-text text-muted">Choose which form to display at this step</small>
                </div>
            `;
        } else {
            // For initial form node, just show the name (read-only)
            html += `
                <div class="mb-3">
                    <label class="form-label">Form Name</label>
                    <input type="text" class="form-control" value="${this.escapeHtml(data.form_name || '')}" disabled />
                </div>
            `;
        }

        html += `
            <div class="mb-3">
                <label class="form-label">Total Fields</label>
                <input type="text" class="form-control" value="${this.escapeHtml(String(data.field_count || 0))}" disabled />
            </div>
        `;

        // Show multi-step information if enabled
        if (data.enable_multi_step && data.step_count > 0) {
            html += `
                <div class="alert alert-success">
                    <i class="bi bi-list-ol"></i> <strong>Multi-Step Form</strong>
                    <br><small class="text-muted">${this.escapeHtml(String(data.step_count))} step${data.step_count > 1 ? 's' : ''} configured</small>
                </div>
            `;

            // Show step details
            if (data.form_steps && data.form_steps.length > 0) {
                html += `
                    <div class="mb-3">
                        <label class="form-label">Form Steps</label>
                        <div class="list-group">
                `;

                data.form_steps.forEach((step, index) => {
                    const stepFields = step.fields || [];
                    html += `
                        <div class="list-group-item">
                            <div class="d-flex justify-content-between align-items-start">
                                <div>
                                    <strong><i class="bi bi-${index + 1}-circle"></i> ${this.escapeHtml(step.title || `Step ${index + 1}`)}</strong>
                                    <small class="text-muted d-block">${stepFields.length} field${stepFields.length !== 1 ? 's' : ''}</small>
                                </div>
                                <span class="badge bg-primary">${index + 1}</span>
                            </div>
                        </div>
                    `;
                });

                html += `
                        </div>
                    </div>
                `;
            }
        }

        if (fields.length > 0) {
            html += `
                <div class="mb-3">
                    <label class="form-label">Form Fields</label>
                    <div class="list-group">
            `;

            fields.forEach(field => {
                const prefillBadge = field.prefill_source ?
                    `<span class="badge bg-info ms-2" title="Auto-filled from ${this.escapeHtml(field.prefill_source)}"><i class="bi bi-magic"></i> ${this.escapeHtml(field.prefill_source)}</span>` : '';
                const requiredBadge = field.required ?
                    `<span class="badge bg-warning ms-1">Required</span>` : '';

                html += `
                    <div class="list-group-item">
                        <div class="d-flex justify-content-between align-items-start">
                            <div>
                                <strong>${this.escapeHtml(field.label)}</strong>
                                <small class="text-muted d-block">${this.escapeHtml(field.name)} (${this.escapeHtml(field.type)})</small>
                            </div>
                            <div>
                                ${requiredBadge}
                                ${prefillBadge}
                            </div>
                        </div>
                    </div>
                `;
            });

            if (hasMoreFields) {
                html += `
                    <div class="list-group-item text-muted text-center">
                        <i class="bi bi-three-dots"></i> More fields available
                    </div>
                `;
            }

            html += `
                    </div>
                </div>
            `;
        }

        html += `
            <div class="mt-3">
                <a href="${this.escapeHtml(data.form_builder_url || '#')}" target="_blank" class="btn btn-outline-primary btn-sm w-100">
                    <i class="bi bi-pencil-square"></i> Edit Form in Form Builder
                </a>
            </div>
        `;

        return html;
    },

    buildApprovalProperties(node) {
        const data = node.data || {};
        let html = `
            <div class="mb-3">
                <label class="form-label">Step Name</label>
                <input type="text" class="form-control" name="step_name" value="${this.escapeHtml(data.step_name || '')}" />
            </div>
            <div class="mb-3">
                <label class="form-label">Approval Type</label>
                <select class="form-select" name="approval_type">
                    <option value="group" ${data.approval_type === 'group' ? 'selected' : ''}>Group Approval</option>
                    <option value="manager" ${data.approval_type === 'manager' ? 'selected' : ''}>Manager Approval</option>
                    <option value="parallel" ${data.approval_type === 'parallel' ? 'selected' : ''}>Parallel Approval</option>
                </select>
            </div>
        `;

        if (data.approval_type === 'group' || !data.approval_type) {
            html += `
                <div class="mb-3">
                    <label class="form-label">Approval Group</label>
                    <select class="form-select" name="group_id">
                        <option value="">Select group...</option>
                        ${this.groups.map(g => `
                            <option value="${g.id}" ${data.group_id == g.id ? 'selected' : ''}>${this.escapeHtml(g.name)}</option>
                        `).join('')}
                    </select>
                </div>
            `;
        }

        return html;
    },

    buildConditionProperties(node) {
        return `
            <div class="alert alert-warning mb-0">
                <i class="bi bi-exclamation-triangle"></i>
                Legacy condition nodes are not currently persisted by the workflow builder. Use workflow or stage <strong>trigger_conditions</strong> in Django Admin for conditional routing.
            </div>
        `;
    },

    buildActionProperties(node) {
        const data = node.data || {};
        return `
            <div class="mb-3">
                <label class="form-label">Action Name</label>
                <input type="text" class="form-control" name="name" value="${this.escapeHtml(data.name || '')}" placeholder="e.g., Update User Record" onchange="workflowBuilder.updateActionConfig('${node.id}')" />
            </div>
            <div class="mb-3">
                <label class="form-label">Action Type</label>
                <select class="form-select" name="action_type" onchange="workflowBuilder.updateActionConfig('${node.id}')">
                    <option value="database" ${data.action_type === 'database' ? 'selected' : ''}>Database Update</option>
                    <option value="ldap" ${data.action_type === 'ldap' ? 'selected' : ''}>LDAP Update</option>
                    <option value="api" ${data.action_type === 'api' ? 'selected' : ''}>API Call</option>
                    <option value="custom" ${data.action_type === 'custom' ? 'selected' : ''}>Custom Handler</option>
                </select>
            </div>
            <div class="mb-3">
                <label class="form-label">When to Execute</label>
                <select class="form-select" name="trigger" onchange="workflowBuilder.updateActionConfig('${node.id}')">
                    <option value="on_submit" ${data.trigger === 'on_submit' ? 'selected' : ''}>On Submission</option>
                    <option value="on_approve" ${data.trigger === 'on_approve' ? 'selected' : ''}>On Approval</option>
                    <option value="on_reject" ${data.trigger === 'on_reject' ? 'selected' : ''}>On Rejection</option>
                    <option value="on_complete" ${data.trigger === 'on_complete' ? 'selected' : ''}>On Complete</option>
                </select>
            </div>
            <hr class="my-3" />
            <div class="mb-3">
                <label class="form-label">Configuration (JSON)</label>
                <textarea class="form-control font-monospace" name="config" rows="4" placeholder='{"table": "users", "field": "status", "value": "approved"}' onchange="workflowBuilder.updateActionConfig('${node.id}')">${this.escapeHtml(typeof data.config === 'string' ? data.config : JSON.stringify(data.config || {}, null, 2))}</textarea>
                <small class="text-muted">Action-specific configuration in JSON format</small>
            </div>
        `;
    },

    buildEmailProperties(node) {
        const data = node.data || {};
        const fieldOptions = this.fields.map(f => `
            <option value="${this.escapeHtml(f.field_name)}" ${data.email_to_field === f.field_name ? 'selected' : ''}>${this.escapeHtml(f.field_label)} (${this.escapeHtml(f.field_name)})</option>
        `).join('');
        const ccFieldOptions = this.fields.map(f => `
            <option value="${this.escapeHtml(f.field_name)}" ${data.email_cc_field === f.field_name ? 'selected' : ''}>${this.escapeHtml(f.field_label)} (${this.escapeHtml(f.field_name)})</option>
        `).join('');
        return `
            <div class="mb-3">
                <label class="form-label">Email Name</label>
                <input type="text" class="form-control" name="name" value="${this.escapeHtml(data.name || '')}" placeholder="e.g., Approval Notification" onchange="workflowBuilder.updateEmailConfig('${node.id}')" />
            </div>
            <div class="mb-3">
                <label class="form-label">Static Recipients</label>
                <input type="text" class="form-control" name="email_to" value="${this.escapeHtml(data.email_to || '')}" placeholder="email@example.com, approver@example.com" onchange="workflowBuilder.updateEmailConfig('${node.id}')" />
                <small class="text-muted">Comma-separated email addresses.</small>
            </div>
            <div class="mb-3">
                <label class="form-label">Recipient Field</label>
                <select class="form-select" name="email_to_field" onchange="workflowBuilder.updateEmailConfig('${node.id}')">
                    <option value="">-- None --</option>
                    ${fieldOptions}
                </select>
                <small class="text-muted">Optional form field that contains the recipient email address.</small>
            </div>
            <div class="mb-3">
                <label class="form-label">CC Addresses</label>
                <input type="text" class="form-control" name="email_cc" value="${this.escapeHtml(data.email_cc || '')}" placeholder="manager@example.com" onchange="workflowBuilder.updateEmailConfig('${node.id}')" />
            </div>
            <div class="mb-3">
                <label class="form-label">CC Field</label>
                <select class="form-select" name="email_cc_field" onchange="workflowBuilder.updateEmailConfig('${node.id}')">
                    <option value="">-- None --</option>
                    ${ccFieldOptions}
                </select>
            </div>
            <div class="mb-3">
                <label class="form-label">When to Send</label>
                <select class="form-select" name="trigger" onchange="workflowBuilder.updateEmailConfig('${node.id}')">
                    <option value="on_submit" ${data.trigger === 'on_submit' ? 'selected' : ''}>On Submission</option>
                    <option value="on_approve" ${data.trigger === 'on_approve' ? 'selected' : ''}>On Approval</option>
                    <option value="on_reject" ${data.trigger === 'on_reject' ? 'selected' : ''}>On Rejection</option>
                    <option value="on_complete" ${data.trigger === 'on_complete' ? 'selected' : ''}>On Complete</option>
                </select>
            </div>
            <div class="mb-3">
                <label class="form-label">Subject Template</label>
                <input type="text" class="form-control" name="email_subject_template" value="${this.escapeHtml(data.email_subject_template || '')}" placeholder="Form {form_name} approved" onchange="workflowBuilder.updateEmailConfig('${node.id}')" />
            </div>
            <div class="mb-3">
                <label class="form-label">Body Template</label>
                <textarea class="form-control" name="email_body_template" rows="5" placeholder="Submission by {submitter} has been approved." onchange="workflowBuilder.updateEmailConfig('${node.id}')">${this.escapeHtml(data.email_body_template || '')}</textarea>
            </div>
            <div class="mb-3">
                <label class="form-label">HTML Template Path</label>
                <input type="text" class="form-control" name="email_template_name" value="${this.escapeHtml(data.email_template_name || '')}" placeholder="emails/approval.html" onchange="workflowBuilder.updateEmailConfig('${node.id}')" />
            </div>
        `;
    },

    buildSubWorkflowProperties(node) {
        const data = node.data || {};

        // Build workflow options from this.workflowTargets
        let workflowOptions = '<option value="">-- Select a workflow --</option>';
        this.workflowTargets.forEach(target => {
            const selected = (data.sub_workflow_id == target.workflow_id) ? 'selected' : '';
            workflowOptions += `<option value="${this.escapeHtml(String(target.workflow_id))}" data-form-id="${this.escapeHtml(String(target.form_id))}" ${selected}>${this.escapeHtml(target.workflow_label)} (${this.escapeHtml(String(target.field_count))} fields)</option>`;
        });

        // Build count field options from this.fields
        let fieldOptions = '<option value="">-- Select a field --</option>';
        this.fields.forEach(f => {
            const selected = (data.count_field === f.field_name) ? 'selected' : '';
            fieldOptions += `<option value="${this.escapeHtml(f.field_name)}" ${selected}>${this.escapeHtml(f.field_label)} (${this.escapeHtml(f.field_name)})</option>`;
        });

        const targetSection = `
            <div class="mb-3">
                <label class="form-label"><strong>Target Workflow</strong></label>
                <select class="form-select" name="sub_workflow_id"
                        onchange="workflowBuilder.updateSubWorkflowConfig('${node.id}')">
                    ${workflowOptions}
                </select>
                <small class="text-muted">The workflow definition used for each sub-workflow instance</small>
            </div>

            <div class="mb-3">
                <label class="form-label"><strong>Section Label</strong></label>
                <input type="text" class="form-control" name="section_label"
                       value="${this.escapeHtml(data.section_label || '')}"
                       placeholder="e.g. Payment Approvals"
                       onchange="workflowBuilder.updateSubWorkflowConfig('${node.id}')" />
                <small class="text-muted">Heading shown to end users in approval history. If blank, uses the workflow name.</small>
            </div>

            <div class="mb-3">
                <label class="form-label"><strong>Count Field</strong></label>
                <select class="form-select" name="count_field"
                        onchange="workflowBuilder.updateSubWorkflowConfig('${node.id}')">
                    ${fieldOptions}
                </select>
                <small class="text-muted">Form field whose value determines how many sub-workflows to spawn</small>
            </div>

            <div class="mb-3">
                <label class="form-label"><strong>Label Template</strong></label>
                <input type="text" class="form-control" name="label_template"
                       value="${this.escapeHtml(data.label_template || 'Sub-workflow {index}')}"
                       onchange="workflowBuilder.updateSubWorkflowConfig('${node.id}')" />
                <small class="text-muted">Use {index} as placeholder (e.g. "Payment {index}")</small>
            </div>
        `;

        const launchSection = `
            <div class="mb-3">
                <label class="form-label"><strong>Trigger</strong></label>
                <select class="form-select" name="trigger"
                        onchange="workflowBuilder.updateSubWorkflowConfig('${node.id}')">
                    <option value="on_submission" ${data.trigger === 'on_submission' ? 'selected' : ''}>On Submission</option>
                    <option value="on_approval" ${data.trigger === 'on_approval' ? 'selected' : ''}>After Parent Approval</option>
                </select>
            </div>

            <div class="mb-3">
                <label class="form-label"><strong>Data Prefix</strong></label>
                <input type="text" class="form-control" name="data_prefix"
                       value="${this.escapeHtml(data.data_prefix || '')}"
                       onchange="workflowBuilder.updateSubWorkflowConfig('${node.id}')" />
                <small class="text-muted">Field prefix to scope data per instance (e.g. "payment" matches payment_type_1, payment_amount_1 …)</small>
            </div>

            <div class="mb-3">
                <div class="form-check form-switch">
                    <input class="form-check-input" type="checkbox" id="sub_wf_detached_${node.id}"
                           name="detached" ${data.detached ? 'checked' : ''}
                           onchange="workflowBuilder.updateSubWorkflowConfig('${node.id}')">
                    <label class="form-check-label" for="sub_wf_detached_${node.id}">
                        <strong>Detached</strong>
                    </label>
                </div>
                <small class="text-muted">When enabled, sub-workflows run independently and don't affect parent status</small>
            </div>

            <div class="mb-3">
                <div class="form-check form-switch">
                    <input class="form-check-input" type="checkbox" id="sub_wf_reject_parent_${node.id}"
                           name="reject_parent" ${data.reject_parent ? 'checked' : ''}
                           onchange="workflowBuilder.updateSubWorkflowConfig('${node.id}')">
                    <label class="form-check-label" for="sub_wf_reject_parent_${node.id}">
                        <strong>Reject Parent on Failure</strong>
                    </label>
                </div>
                <small class="text-muted">When enabled, rejecting any sub-workflow rejects the parent and cancels siblings</small>
            </div>
        `;

        return `
            <div class="alert alert-info">
                <i class="bi bi-info-circle"></i> Configure a sub-workflow that spawns child approval processes based on a form field value.
            </div>
            ${this.buildPropertySection('Workflow Target & Labels', targetSection, {
                icon: 'boxes',
                description: 'Choose which child workflow to launch and how it should appear to reviewers.',
            })}
            ${this.buildPropertySection('Launch & Parent Behavior', launchSection, {
                icon: 'arrow-repeat',
                description: 'Define when the child workflow runs and whether it can affect the parent workflow.',
            })}
        `;
    },

    updateSubWorkflowConfig(nodeId) {
        const node = this.nodes.find(n => n.id === nodeId);
        if (!node) return;

        const container = document.getElementById('propertiesContent');
        const subWfSelect = container.querySelector('select[name="sub_workflow_id"]');
        node.data.sub_workflow_id = subWfSelect.value ? parseInt(subWfSelect.value) : null;
        const selectedOption = subWfSelect.selectedOptions[0];
        node.data.sub_workflow_name = selectedOption && selectedOption.value ? selectedOption.text : '';
        node.data.sub_workflow_form_id = selectedOption && selectedOption.dataset.formId ? parseInt(selectedOption.dataset.formId) : null;

        node.data.section_label = container.querySelector('input[name="section_label"]').value;
        node.data.count_field = container.querySelector('select[name="count_field"]').value;
        node.data.label_template = container.querySelector('input[name="label_template"]').value;
        node.data.trigger = container.querySelector('select[name="trigger"]').value;
        node.data.data_prefix = container.querySelector('input[name="data_prefix"]').value;
        node.data.detached = container.querySelector(`#sub_wf_detached_${nodeId}`).checked;
        node.data.reject_parent = container.querySelector(`#sub_wf_reject_parent_${nodeId}`).checked;

        this.nodes = [...this.nodes];
        this.render();
        this.selectNode(nodeId);
    },

    buildEndProperties(node) {
        return `
            <div class="alert alert-info">
                <i class="bi bi-info-circle"></i> This is the terminal node where the workflow ends.
            </div>
            <p class="text-muted">
                The workflow completes when it reaches this node. The final status is determined by
                which path led to this end node (e.g., approval path vs. rejection path).
            </p>
        `;
    },

    updateNodeProperty(nodeId, property, value) {
        const node = this.nodes.find(n => n.id === nodeId);
        if (node) {
            node.data[property] = value;
            this.nodes = [...this.nodes];
            this.render();
        }
    },

    updateFormSelection(nodeId, formId) {
        const node = this.nodes.find(n => n.id === nodeId);
        if (!node) return;

        // Find the selected form
        const selectedForm = this.forms.find(f => f.id == formId);
        if (!selectedForm) {
            // Clear form data if no form selected
            node.data.form_id = null;
            node.data.form_name = 'Select Form';
            node.data.form_builder_url = '#';
            node.data.field_count = 0;
            node.data.fields = [];
            node.data.has_more_fields = false;
        } else {
            // Update node with selected form data
            node.data.form_id = selectedForm.id;
            node.data.form_name = selectedForm.name;
            node.data.form_builder_url = `/admin/django_forms_workflows/formdefinition/${selectedForm.id}/builder/`;
            node.data.field_count = selectedForm.field_count;
            // Note: We don't load full field details here for performance
            // The backend will load them when needed
            node.data.fields = [];
            node.data.has_more_fields = selectedForm.field_count > 0;
        }

        // Re-render to update the node display and properties panel
        this.nodes = [...this.nodes];
        this.render();
        this.selectNode(nodeId); // Re-select to refresh properties panel
    },

    updateStageConfig(nodeId) {
        const node = this.nodes.find(n => n.id === nodeId);
        if (!node) return;

        const container = document.getElementById('propertiesContent');
        node.data.name = container.querySelector('input[name="name"]').value;
        node.data.order = parseInt(container.querySelector('input[name="order"]').value) || 1;
        node.data.approve_label = container.querySelector('input[name="approve_label"]').value;
        node.data.requires_manager_approval = container.querySelector(`#stage_requires_manager_${nodeId}`).checked;
        node.data.allow_send_back = container.querySelector(`#stage_allow_send_back_${nodeId}`).checked;
        node.data.allow_reassign = container.querySelector(`#stage_allow_reassign_${nodeId}`).checked;
        node.data.allow_edit_form_data = container.querySelector(`#stage_allow_edit_form_data_${nodeId}`).checked;
        node.data.assignee_form_field = container.querySelector('select[name="assignee_form_field"]').value;
        node.data.assignee_lookup_type = container.querySelector('select[name="assignee_lookup_type"]').value;
        node.data.validate_assignee_group = container.querySelector(`#stage_validate_assignee_group_${nodeId}`).checked;
        node.data.trigger_conditions = this.readNodeTriggerConditions(container);
        node.data.approval_groups = this.readStageApprovalGroupsFromPanel(
            container,
            nodeId,
            node.data.approval_groups || []
        );
        node.data.approval_fields = this.readStageApprovalFieldsFromPanel(container, nodeId);
        node.data.approval_logic = container.querySelector('select[name="approval_logic"]').value;

        this.nodes = [...this.nodes];
        this.render();
        this.selectNode(nodeId);
    },

    updateWorkflowSettings(nodeId) {
        const node = this.nodes.find(n => n.id === nodeId);
        if (!node) return;

        const container = document.getElementById('propertiesContent');

        // Numeric fields (empty → null)
        ['approval_deadline_days', 'send_reminder_after_days', 'auto_approve_after_days'].forEach(key => {
            const val = container.querySelector(`input[name="${key}"]`).value;
            node.data[key] = val ? parseInt(val) : null;
        });

        node.data.name_label = container.querySelector('input[name="name_label"]').value;
        node.data.notification_cadence = container.querySelector('select[name="notification_cadence"]').value;
        const cadenceDay = container.querySelector('input[name="notification_cadence_day"]').value;
        node.data.notification_cadence_day = cadenceDay ? parseInt(cadenceDay) : null;
        node.data.notification_cadence_time = container.querySelector('input[name="notification_cadence_time"]').value;
        node.data.notification_cadence_form_field = container.querySelector('select[name="notification_cadence_form_field"]').value;
        node.data.notification_rules = this.readNotificationRulesFromPanel(container);
        node.data.trigger_conditions = this.readNodeTriggerConditions(container);

        this.nodes = [...this.nodes];
        this.render();
        this.selectNode(nodeId);
    },

    readConditionsFromEditor(editorElement) {
        if (!editorElement) {
            return null;
        }

        const operatorElement = editorElement.querySelector('select[name="condition_group_operator"]');
        const rows = Array.from(editorElement.querySelectorAll('.trigger-condition-row'));
        const conditions = rows.map(row => {
            const operator = row.querySelector('select[name="condition_operator"]').value;
            const condition = {
                field: row.querySelector('select[name="condition_field"]').value,
                operator,
            };
            if (!['is_empty', 'not_empty'].includes(operator)) {
                condition.value = row.querySelector('input[name="condition_value"]').value;
            }
            return condition;
        }).filter(condition => condition.field);

        if (!conditions.length) {
            return null;
        }

        return {
            operator: operatorElement ? operatorElement.value : 'AND',
            conditions,
        };
    },

    readNodeTriggerConditions(container) {
        return this.readConditionsFromEditor(
            container.querySelector('.conditions-editor[data-editor-kind="node-trigger"]')
        );
    },

    readStageApprovalGroupsFromPanel(container, nodeId, existingGroups) {
        const groupSelect = container.querySelector(`#stage_groups_${nodeId}`);
        const selected = Array.from(groupSelect.selectedOptions).map(opt => ({
            id: parseInt(opt.value),
            name: opt.text,
        }));
        const existingOrdered = this.getNormalizedStageApprovalGroups(existingGroups || []);
        const existingMap = new Map(existingOrdered.map(group => [group.id, group]));

        const kept = existingOrdered.filter(group => selected.some(sel => sel.id === group.id));
        const appended = selected
            .filter(group => !existingMap.has(group.id))
            .map(group => ({ id: group.id, name: group.name }));

        return [...kept, ...appended].map((group, index) => ({
            id: group.id,
            name: group.name,
            position: index,
        }));
    },

    readStageApprovalFieldsFromPanel(container, nodeId) {
        const fieldSelect = container.querySelector(`#stage_fields_${nodeId}`);
        if (!fieldSelect) {
            return [];
        }

        return Array.from(fieldSelect.selectedOptions).map(option => {
            const fieldId = parseInt(option.value);
            const field = this.fields.find(entry => entry.id === fieldId);
            return {
                id: fieldId,
                field_name: field?.field_name || option.text,
                field_label: field?.field_label || option.text,
                field_type: field?.field_type || '',
                order: field?.order ?? 0,
            };
        });
    },

    moveStageApprovalGroup(nodeId, groupId, direction) {
        const node = this.nodes.find(n => n.id === nodeId);
        if (!node) return;

        const groups = this.getNormalizedStageApprovalGroups(node.data.approval_groups || []);
        const currentIndex = groups.findIndex(group => group.id === groupId);
        const targetIndex = currentIndex + direction;
        if (currentIndex < 0 || targetIndex < 0 || targetIndex >= groups.length) {
            return;
        }

        [groups[currentIndex], groups[targetIndex]] = [groups[targetIndex], groups[currentIndex]];
        node.data.approval_groups = groups.map((group, index) => ({ ...group, position: index }));
        this.nodes = [...this.nodes];
        this.render();
        this.selectNode(nodeId);
    },

    readNotificationRulesFromPanel(container) {
        return Array.from(container.querySelectorAll('.notification-rule-card')).map(card => {
            const stageNodeId = card.querySelector('select[name="notification_rule_stage"]').value;
            const notifyGroups = Array.from(card.querySelector('select[name="notification_rule_notify_groups"]').selectedOptions).map(opt => ({
                id: parseInt(opt.value),
                name: opt.text,
            }));
            return {
                rule_id: card.dataset.ruleId ? parseInt(card.dataset.ruleId) : null,
                stage_node_id: stageNodeId || '',
                event: card.querySelector('select[name="notification_rule_event"]').value,
                subject_template: card.querySelector('input[name="notification_rule_subject_template"]').value,
                notify_submitter: card.querySelector('input[name="notification_rule_notify_submitter"]').checked,
                email_field: card.querySelector('select[name="notification_rule_email_field"]').value,
                static_emails: card.querySelector('input[name="notification_rule_static_emails"]').value,
                notify_stage_assignees: card.querySelector('input[name="notification_rule_notify_stage_assignees"]').checked,
                notify_stage_groups: card.querySelector('input[name="notification_rule_notify_stage_groups"]').checked,
                notify_groups: notifyGroups,
                conditions: this.readConditionsFromEditor(
                    card.querySelector('.conditions-editor[data-editor-kind="notification-rule"]')
                ),
            };
        }).filter(rule => (
            rule.notify_submitter
            || rule.email_field
            || rule.static_emails
            || rule.notify_stage_assignees
            || rule.notify_stage_groups
            || rule.notify_groups.length > 0
            || rule.subject_template
            || (rule.conditions && rule.conditions.conditions && rule.conditions.conditions.length > 0)
        ));
    },

    addNotificationRule(nodeId) {
        const node = this.nodes.find(n => n.id === nodeId);
        if (!node) return;

        node.data.notification_rules = [...(node.data.notification_rules || []), this.getNotificationRuleState({})];
        this.nodes = [...this.nodes];
        this.render();
        this.selectNode(nodeId);
    },

    removeNotificationRule(nodeId, index) {
        const node = this.nodes.find(n => n.id === nodeId);
        if (!node) return;

        const rules = [...(node.data.notification_rules || [])];
        rules.splice(index, 1);
        node.data.notification_rules = rules;
        this.nodes = [...this.nodes];
        this.render();
        this.selectNode(nodeId);
    },

    addNotificationRuleCondition(nodeId, ruleIndex) {
        const node = this.nodes.find(n => n.id === nodeId);
        if (!node) return;

        const rules = [...(node.data.notification_rules || [])];
        const rule = this.getNotificationRuleState(rules[ruleIndex] || {});
        const state = this.getNormalizedTriggerConditions(rule.conditions);
        state.conditions.push({ field: '', operator: 'equals', value: '' });
        rules[ruleIndex] = { ...rule, conditions: state };
        node.data.notification_rules = rules;
        this.nodes = [...this.nodes];
        this.render();
        this.selectNode(nodeId);
    },

    removeNotificationRuleCondition(nodeId, ruleIndex, conditionIndex) {
        const node = this.nodes.find(n => n.id === nodeId);
        if (!node) return;

        const rules = [...(node.data.notification_rules || [])];
        const rule = this.getNotificationRuleState(rules[ruleIndex] || {});
        const state = this.getNormalizedTriggerConditions(rule.conditions);
        state.conditions.splice(conditionIndex, 1);
        rules[ruleIndex] = { ...rule, conditions: state.conditions.length ? state : null };
        node.data.notification_rules = rules;
        this.nodes = [...this.nodes];
        this.render();
        this.selectNode(nodeId);
    },

    updateNotificationRules(nodeId) {
        const node = this.nodes.find(n => n.id === nodeId);
        if (!node) return;

        const container = document.getElementById('propertiesContent');
        node.data.notification_rules = this.readNotificationRulesFromPanel(container);
        this.nodes = [...this.nodes];
        this.render();
        this.selectNode(nodeId);
    },

    addTriggerCondition(nodeId) {
        const node = this.nodes.find(n => n.id === nodeId);
        if (!node) return;

        const state = this.getNormalizedTriggerConditions(node.data.trigger_conditions);
        state.conditions.push({ field: '', operator: 'equals', value: '' });
        node.data.trigger_conditions = state;
        this.nodes = [...this.nodes];
        this.render();
        this.selectNode(nodeId);
    },

    removeTriggerCondition(nodeId, index) {
        const node = this.nodes.find(n => n.id === nodeId);
        if (!node) return;

        const state = this.getNormalizedTriggerConditions(node.data.trigger_conditions);
        state.conditions.splice(index, 1);
        node.data.trigger_conditions = state.conditions.length ? state : null;
        this.nodes = [...this.nodes];
        this.render();
        this.selectNode(nodeId);
    },

    updateNodeTriggerConditions(nodeId) {
        const node = this.nodes.find(n => n.id === nodeId);
        if (!node) return;

        const container = document.getElementById('propertiesContent');
        node.data.trigger_conditions = this.readNodeTriggerConditions(container);
        this.nodes = [...this.nodes];
        this.render();
        this.selectNode(nodeId);
    },

    updateActionConfig(nodeId) {
        const node = this.nodes.find(n => n.id === nodeId);
        if (!node) return;

        const container = document.getElementById('propertiesContent');
        node.data.name = container.querySelector('input[name="name"]').value;
        node.data.action_type = container.querySelector('select[name="action_type"]').value;
        node.data.trigger = container.querySelector('select[name="trigger"]').value;
        node.data.config = container.querySelector('textarea[name="config"]').value;

        this.nodes = [...this.nodes];
        this.render();
        this.selectNode(nodeId);
    },

    updateEmailConfig(nodeId) {
        const node = this.nodes.find(n => n.id === nodeId);
        if (!node) return;

        const container = document.getElementById('propertiesContent');
        node.data.name = container.querySelector('input[name="name"]').value;
        node.data.email_to = container.querySelector('input[name="email_to"]').value;
        node.data.email_to_field = container.querySelector('select[name="email_to_field"]').value;
        node.data.email_cc = container.querySelector('input[name="email_cc"]').value;
        node.data.email_cc_field = container.querySelector('select[name="email_cc_field"]').value;
        node.data.email_subject_template = container.querySelector('input[name="email_subject_template"]').value;
        node.data.email_body_template = container.querySelector('textarea[name="email_body_template"]').value;
        node.data.email_template_name = container.querySelector('input[name="email_template_name"]').value;
        node.data.trigger = container.querySelector('select[name="trigger"]').value;

        this.nodes = [...this.nodes];
        this.render();
        this.selectNode(nodeId);
    },
};
