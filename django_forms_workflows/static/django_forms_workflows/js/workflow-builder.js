/**
 * Visual Workflow Builder
 *
 * Drag-and-drop workflow builder for post-submission actions and approvals.
 */

import { createWorkflowBuilderStore } from './workflow-builder-store.js';
import { apiMethods } from './workflow-builder-api.js';
import { propertyEditorMethods } from './workflow-builder-property-editor.js';

export class WorkflowBuilder {
    constructor(config) {
        this.config = config;
        this.store = createWorkflowBuilderStore();
        this.nodes = [];
        this.connections = [];
        this.selectedNode = null;
        this.selectedConnection = null;
        this.nodeIdCounter = 1;
        this.isDraggingNode = false;
        this.isConnecting = false;
        this.connectionStart = null;
        this.tempLine = null;
        this.fields = [];
        this.groups = [];
        this.forms = [];
        this.workflowTargets = [];
        this.validationState = { errors: [], warnings: [], nodeIssues: {}, firstErrorNodeId: null };
        this.isDirty = false;
        this.isSaving = false;
        this.lastSavedWorkflowSnapshot = null;
        this.nodeStackOrder = new Map();
        this.nextNodeStackOrder = 1;
        this.draggingNodeId = null;

        // Pan & zoom state
        this.panX = 0;
        this.panY = 0;
        this.zoom = 1;
        this.isPanning = false;
        this.minZoom = 0.25;
        this.maxZoom = 2;
        this.workspaceWidth = 0;
        this.workspaceHeight = 0;
        this.minWorkspaceWidth = 2400;
        this.minWorkspaceHeight = 1600;
        this.workspacePaddingX = 360;
        this.workspacePaddingY = 280;

        this.init();
    }

    // nodes/connections/nodeIdCounter live on this.store now (single source
    // of truth for a future history/undo module's snapshots); these proxy
    // the existing this.nodes/this.connections/this.nodeIdCounter call sites
    // throughout this file so they don't all need to change in this pass.
    // Mirrors form-builder.js's identical this.store proxy pattern.
    get nodes() { return this.store.nodes; }
    set nodes(value) { this.store.setNodes(value); }

    get connections() { return this.store.connections; }
    set connections(value) { this.store.setConnections(value); }

    get nodeIdCounter() { return this.store.nodeIdCounter; }
    set nodeIdCounter(value) { this.store.nodeIdCounter = value; }

    async init() {
        console.log('Initializing workflow builder...');
        this.setupCanvas();
        this.setupPalette();
        this.setupEventListeners();
        await this.loadWorkflow();

        console.log('After load, nodes count:', this.nodes.length);

        // Create start node if no nodes exist
        if (this.nodes.length === 0) {
            console.log('No nodes found, creating start node');
            this.createStartNode();
        }

        this.syncSavedWorkflowSnapshot();

        console.log('Rendering workflow...');
        this.render();
        console.log('Workflow builder initialized');
    }

    setupCanvas() {
        this.canvas = document.getElementById('workflowCanvas');
        this.svg = document.getElementById('connectionsSvg');

        // Create a single transform wrapper that holds both SVG and nodes.
        // Applying pan/zoom to one wrapper keeps arrows and nodes aligned.
        this.transformWrapper = document.createElement('div');
        this.transformWrapper.className = 'workflow-transform-wrapper';

        // Move SVG into the wrapper, then add wrapper to canvas
        this.canvas.appendChild(this.transformWrapper);
        this.transformWrapper.appendChild(this.svg);
        this.updateWorkspaceBounds();
        window.addEventListener('resize', () => this.updateWorkspaceBounds());

        // Make canvas droppable
        this.canvas.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        });

        this.canvas.addEventListener('drop', (e) => {
            e.preventDefault();
            const nodeType = e.dataTransfer.getData('nodeType');
            if (nodeType) {
                const [x, y] = this.clientToCanvas(e.clientX, e.clientY);
                this.createNode(nodeType, x, y);
            }
        });

        // Click on canvas background to deselect
        this.canvas.addEventListener('click', (e) => {
            if (e.target === this.canvas || e.target === this.svg
                || e.target === this.transformWrapper) {
                this.deselectAll();
            }
        });

        // ── Pan (left-drag on background, or middle-click anywhere blank) ──
        this.canvas.addEventListener('mousedown', (e) => {
            const isBackground = e.target === this.canvas || e.target === this.svg
                || e.target === this.transformWrapper
                || e.target.tagName === 'svg' || e.target.closest('.connections-svg');
            const shouldPan = isBackground && (e.button === 0 || e.button === 1);
            if (!shouldPan) return;

            e.preventDefault();
            this.isPanning = true;
            this.canvas.classList.add('is-panning');
            const startX = e.clientX, startY = e.clientY;
            const startPanX = this.panX, startPanY = this.panY;

            const onMove = (ev) => {
                this.panX = startPanX + (ev.clientX - startX);
                this.panY = startPanY + (ev.clientY - startY);
                this.applyTransform();
            };
            const onUp = () => {
                this.isPanning = false;
                this.canvas.classList.remove('is-panning');
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });

        // Prevent default middle-click scroll
        this.canvas.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });

        // ── Zoom (mouse wheel) ──────────────────────────────────────────
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const rect = this.canvas.getBoundingClientRect();
            // Cursor position relative to canvas element
            const cx = e.clientX - rect.left;
            const cy = e.clientY - rect.top;

            const oldZoom = this.zoom;
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, this.zoom + delta));

            // Adjust pan so zoom centres on cursor
            const scale = this.zoom / oldZoom;
            this.panX = cx - scale * (cx - this.panX);
            this.panY = cy - scale * (cy - this.panY);

            this.applyTransform();
            this.updateZoomIndicator();
        }, { passive: false });
    }

    /** Convert client (screen) coordinates to canvas (node) coordinates. */
    clientToCanvas(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        const x = (clientX - rect.left + this.canvas.scrollLeft - this.panX) / this.zoom;
        const y = (clientY - rect.top + this.canvas.scrollTop - this.panY) / this.zoom;
        return [x, y];
    }

    getWorkspaceBounds(extraPoints = []) {
        const viewportWidth = this.canvas?.clientWidth || 0;
        const viewportHeight = this.canvas?.clientHeight || 0;
        let maxX = Math.max(this.minWorkspaceWidth, viewportWidth + this.workspacePaddingX);
        let maxY = Math.max(this.minWorkspaceHeight, viewportHeight + this.workspacePaddingY);

        this.nodes.forEach((node) => {
            maxX = Math.max(maxX, node.x + 340 + this.workspacePaddingX);
            maxY = Math.max(maxY, node.y + 220 + this.workspacePaddingY);
        });

        extraPoints.forEach((point) => {
            if (!point) return;
            maxX = Math.max(maxX, point.x + this.workspacePaddingX);
            maxY = Math.max(maxY, point.y + this.workspacePaddingY);
        });

        return {
            width: Math.ceil(maxX),
            height: Math.ceil(maxY),
        };
    }

    setWorkspaceSize(width, height) {
        if (!this.transformWrapper || !this.svg) return;
        if (width === this.workspaceWidth && height === this.workspaceHeight) return;

        this.workspaceWidth = width;
        this.workspaceHeight = height;
        this.transformWrapper.style.width = `${width}px`;
        this.transformWrapper.style.height = `${height}px`;
        this.svg.setAttribute('width', width);
        this.svg.setAttribute('height', height);
        this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    }

    updateWorkspaceBounds(extraPoints = []) {
        if (!this.canvas || !this.transformWrapper || !this.svg) return;
        const bounds = this.getWorkspaceBounds(extraPoints);
        this.setWorkspaceSize(bounds.width, bounds.height);
    }

    /** Apply the current pan/zoom transform to the single wrapper (nodes + SVG). */
    applyTransform() {
        const t = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
        this.transformWrapper.style.transform = t;
    }

    /** Update the zoom percentage indicator. */
    updateZoomIndicator() {
        const el = document.getElementById('zoomLevel');
        if (el) el.textContent = `${Math.round(this.zoom * 100)}%`;
    }

    /** Zoom to a specific level, centred on the canvas midpoint. */
    setZoom(newZoom) {
        const rect = this.canvas.getBoundingClientRect();
        const cx = rect.width / 2, cy = rect.height / 2;
        const oldZoom = this.zoom;
        this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, newZoom));
        const scale = this.zoom / oldZoom;
        this.panX = cx - scale * (cx - this.panX);
        this.panY = cy - scale * (cy - this.panY);
        this.applyTransform();
        this.updateZoomIndicator();
    }

    /** Reset pan/zoom to default. */
    resetView() {
        this.panX = 0;
        this.panY = 0;
        this.zoom = 1;
        this.applyTransform();
        this.updateZoomIndicator();
    }

    setupPalette() {
        const paletteNodes = document.querySelectorAll('.palette-node');
        paletteNodes.forEach(node => {
            node.addEventListener('dragstart', (e) => {
                const nodeType = node.dataset.nodeType;
                e.dataTransfer.setData('nodeType', nodeType);
                e.dataTransfer.effectAllowed = 'copy';
            });
        });
    }

    setupEventListeners() {
        document.getElementById('btnSave').addEventListener('click', () => this.saveWorkflow());
        const autoArrangeBtn = document.getElementById('btnAutoArrange');
        if (autoArrangeBtn) {
            autoArrangeBtn.addEventListener('click', () => this.autoArrangeNodes());
        }
        const deleteConnectionBtn = document.getElementById('btnDeleteConnection');
        if (deleteConnectionBtn) {
            deleteConnectionBtn.addEventListener('click', () => this.deleteSelectedConnection());
        }
        const workflowTrackSelect = document.getElementById('workflowTrackSelect');
        if (workflowTrackSelect) {
            workflowTrackSelect.addEventListener('change', (event) => {
                const workflowId = event.target.value;
                // Validate that workflowId is a safe integer before using in URL
                if (/^\d+$/.test(workflowId)) {
                    const url = new URL(this.config.workflowBuilderUrl, window.location.origin);
                    url.searchParams.set('workflow_id', workflowId);
                    window.location.href = url.toString();
                }
            });
        }

        window.addEventListener('beforeunload', (event) => {
            if (!this.isDirty || this.isSaving) return;
            event.preventDefault();
            event.returnValue = '';
        });

        document.addEventListener('keydown', (event) => {
            if (this.selectedConnection === null) return;
            if (this.isEditableElement(document.activeElement)) return;
            if (event.key === 'Delete' || event.key === 'Backspace') {
                event.preventDefault();
                this.deleteSelectedConnection();
            }
        });
    }

    isEditableElement(element) {
        if (!element) return false;
        const tagName = element.tagName?.toLowerCase();
        return element.isContentEditable || ['input', 'textarea', 'select'].includes(tagName);
    }

    formatNodeReference(node) {
        if (!node) return 'Unknown node';
        const specificName = node.data?.name || node.data?.sub_workflow_name || node.data?.name_label || node.data?.form_name;
        return specificName
            ? `${this.getNodeTypeLabel(node.type)}: ${specificName}`
            : this.getNodeTypeLabel(node.type);
    }

    updateConnectionSelectionUI() {
        const button = document.getElementById('btnDeleteConnection');
        const status = document.getElementById('selectionStatus');
        const hasSelection = this.selectedConnection !== null && this.connections[this.selectedConnection];

        if (button) {
            button.disabled = !hasSelection;
        }

        if (!status) return;

        if (!hasSelection) {
            status.innerHTML = '';
            return;
        }

        const connection = this.connections[this.selectedConnection];
        const fromNode = this.nodes.find(node => node.id === connection.from);
        const toNode = this.nodes.find(node => node.id === connection.to);
        status.innerHTML = `
            <div class="alert alert-primary py-2 px-3 mb-0 d-flex align-items-center justify-content-between gap-2">
                <div>
                    <div class="fw-semibold"><i class="bi bi-bezier2"></i> Connection selected</div>
                    <div class="small">${this.escapeHtml(this.formatNodeReference(fromNode))} → ${this.escapeHtml(this.formatNodeReference(toNode))}</div>
                </div>
                <button type="button" class="btn btn-sm btn-outline-danger" onclick="workflowBuilder.deleteSelectedConnection()">
                    <i class="bi bi-trash"></i> Remove
                </button>
            </div>
        `;
    }

    setBuilderMessage(level, title, details = [], autoHide = false) {
        const container = document.getElementById('builderMessage');
        if (!container) return;

        const safeDetails = (details || []).slice(0, 6);
        container.innerHTML = `
            <div class="alert alert-${level} mb-2 py-2 px-3">
                <div class="fw-semibold">${this.escapeHtml(title)}</div>
                ${safeDetails.length ? `
                    <ul class="mb-0 small mt-2">
                        ${safeDetails.map(detail => `<li>${this.escapeHtml(detail)}</li>`).join('')}
                    </ul>
                ` : ''}
            </div>
        `;

        if (autoHide) {
            window.clearTimeout(this.builderMessageTimeout);
            this.builderMessageTimeout = window.setTimeout(() => {
                if (container) {
                    container.innerHTML = '';
                }
            }, 4000);
        }
    }

    updateValidationDisplay() {
        const container = document.getElementById('validationSummary');
        if (!container) return;

        const { errors, warnings } = this.validationState;
        if (errors.length) {
            container.innerHTML = `
                <div class="alert alert-danger validation-summary mb-0 py-2 px-3">
                    <div class="fw-semibold"><i class="bi bi-exclamation-triangle"></i> ${errors.length} validation error${errors.length === 1 ? '' : 's'} blocking save</div>
                    <ul class="small mb-0 mt-2">
                        ${errors.slice(0, 4).map(error => `<li>${this.escapeHtml(error)}</li>`).join('')}
                    </ul>
                </div>
            `;
            return;
        }

        if (warnings.length) {
            container.innerHTML = `
                <div class="alert alert-warning validation-summary mb-0 py-2 px-3">
                    <div class="fw-semibold"><i class="bi bi-exclamation-circle"></i> ${warnings.length} warning${warnings.length === 1 ? '' : 's'}</div>
                    <ul class="small mb-0 mt-2">
                        ${warnings.slice(0, 4).map(warning => `<li>${this.escapeHtml(warning)}</li>`).join('')}
                    </ul>
                </div>
            `;
            return;
        }

        container.innerHTML = `
            <div class="alert alert-success validation-summary mb-0 py-2 px-3">
                <div class="fw-semibold"><i class="bi bi-check-circle"></i> Builder validation looks good</div>
            </div>
        `;
    }

    createStartNode() {
        const node = {
            id: this.store.nextNodeId(),
            type: 'start',
            x: 100,
            y: 100,
            data: {}
        };
        this.nodes = [...this.nodes, node];
        this.bringNodeToFront(node.id);
        this.render();
    }

    createNode(type, x, y) {
        const node = {
            id: this.store.nextNodeId(),
            type: type,
            x: x,
            y: y,
            data: this.getDefaultNodeData(type)
        };
        this.nodes = [...this.nodes, node];
        this.bringNodeToFront(node.id);
        this.render();
    }

    initializeNodeStackOrder() {
        this.nodeStackOrder = new Map();
        this.nextNodeStackOrder = 1;
        this.nodes.forEach((node) => {
            this.nodeStackOrder.set(node.id, this.nextNodeStackOrder++);
        });
    }

    bringNodeToFront(nodeId) {
        if (!nodeId) return;
        this.nodeStackOrder.set(nodeId, this.nextNodeStackOrder++);
    }

    getEstimatedNodeWidth(type) {
        switch (type) {
            case 'workflow_settings':
                return 320;
            case 'form':
            case 'sub_workflow':
                return 300;
            case 'stage':
            case 'approval':
            case 'approval_config':
                return 280;
            case 'action':
            case 'email':
            case 'condition':
                return 260;
            case 'join':
                return 140;
            case 'start':
            case 'end':
                return 180;
            default:
                return 240;
        }
    }

    getEstimatedNodeHeight(type) {
        switch (type) {
            case 'workflow_settings':
                return 180;
            case 'form':
            case 'sub_workflow':
                return 170;
            case 'stage':
            case 'approval':
            case 'approval_config':
                return 160;
            case 'action':
            case 'email':
            case 'condition':
                return 150;
            case 'join':
                return 96;
            default:
                return 140;
        }
    }

    nodesOverlap(a, b, padding = 16) {
        const aWidth = this.getEstimatedNodeWidth(a.type);
        const aHeight = this.getEstimatedNodeHeight(a.type);
        const bWidth = this.getEstimatedNodeWidth(b.type);
        const bHeight = this.getEstimatedNodeHeight(b.type);

        return !(
            a.x + aWidth + padding <= b.x
            || b.x + bWidth + padding <= a.x
            || a.y + aHeight + padding <= b.y
            || b.y + bHeight + padding <= a.y
        );
    }

    getParallelStageGroups() {
        const groups = new Map();

        this.nodes
            .filter((node) => node.type === 'stage' && node.data?.order !== undefined && node.data?.order !== null)
            .forEach((node) => {
                const key = String(node.data.order);
                if (!groups.has(key)) {
                    groups.set(key, []);
                }
                groups.get(key).push(node);
            });

        return [...groups.values()]
            .filter((group) => group.length > 1)
            .map((group) => group.sort((a, b) => (a.y - b.y) || (a.x - b.x)));
    }

    parallelStageGroupsNeedNormalization() {
        const expectedVerticalGap = 220;

        return this.getParallelStageGroups().some((group) => {
            const anchorX = Math.min(...group.map((node) => node.x));
            const xDrift = group.some((node) => Math.abs(node.x - anchorX) > 24);
            if (xDrift) {
                return true;
            }

            for (let index = 1; index < group.length; index += 1) {
                const gap = group[index].y - group[index - 1].y;
                if (Math.abs(gap - expectedVerticalGap) > 24) {
                    return true;
                }
            }

            return false;
        });
    }

    normalizeParallelStageGroups() {
        const verticalGap = 220;

        this.getParallelStageGroups().forEach((group) => {
            const anchorX = Math.min(...group.map((node) => node.x));
            const centerY = Math.round(
                group.reduce((total, node) => total + node.y, 0) / group.length,
            );
            const startY = centerY - ((group.length - 1) * verticalGap) / 2;

            group.forEach((node, index) => {
                node.x = anchorX;
                node.y = Math.round(startY + (index * verticalGap));
            });
        });
    }

    layoutNeedsNormalization() {
        const nodes = [...this.nodes];
        const sameLaneThreshold = 110;
        const minimumGap = 56;

        if (this.parallelStageGroupsNeedNormalization()) {
            return true;
        }

        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                if (this.nodesOverlap(nodes[i], nodes[j], 20)) {
                    return true;
                }
            }
        }

        const byLane = [...nodes].sort((a, b) => (a.y - b.y) || (a.x - b.x));
        for (let i = 1; i < byLane.length; i++) {
            const prev = byLane[i - 1];
            const current = byLane[i];
            if (Math.abs(current.y - prev.y) > sameLaneThreshold || current.x < prev.x) {
                continue;
            }
            const requiredX = prev.x + this.getEstimatedNodeWidth(prev.type) + minimumGap;
            if (current.x < requiredX) {
                return true;
            }
        }

        return false;
    }

    resolveNodeCollisions() {
        const sortedNodes = [...this.nodes].sort((a, b) => (a.x - b.x) || (a.y - b.y));

        sortedNodes.forEach((node, index) => {
            let attempts = 0;
            while (attempts < 24) {
                const blockingNode = sortedNodes
                    .slice(0, index)
                    .find((candidate) => this.nodesOverlap(candidate, node, 12));
                if (!blockingNode) {
                    break;
                }

                const sameLane = Math.abs(blockingNode.y - node.y) <= 110;
                if (sameLane) {
                    node.x = Math.max(
                        node.x,
                        blockingNode.x + this.getEstimatedNodeWidth(blockingNode.type) + 72,
                    );
                } else {
                    node.y = Math.max(
                        node.y,
                        blockingNode.y + this.getEstimatedNodeHeight(blockingNode.type) + 52,
                    );
                }
                attempts += 1;
            }
        });
    }

    autoArrangeNodes(options = {}) {
        const { suppressRender = false, silent = false } = options;
        if (!this.nodes.length) return;

        const laneThreshold = 120;
        const horizontalGap = 84;
        const sortedByY = [...this.nodes].sort((a, b) => (a.y - b.y) || (a.x - b.x));
        const lanes = [];

        sortedByY.forEach((node) => {
            let lane = lanes.find((candidate) => Math.abs(candidate.centerY - node.y) <= laneThreshold);
            if (!lane) {
                lane = { centerY: node.y, nodes: [] };
                lanes.push(lane);
            }
            lane.nodes.push(node);
            lane.centerY = Math.round(lane.nodes.reduce((total, entry) => total + entry.y, 0) / lane.nodes.length);
        });

        lanes
            .sort((a, b) => a.centerY - b.centerY)
            .forEach((lane) => {
                lane.nodes.sort((a, b) => a.x - b.x);
                let cursorX = Math.max(80, lane.nodes[0]?.x || 80);
                lane.nodes.forEach((node, index) => {
                    if (index === 0) {
                        node.x = Math.max(80, node.x);
                    } else {
                        node.x = Math.max(node.x, cursorX);
                    }
                    cursorX = node.x + this.getEstimatedNodeWidth(node.type) + horizontalGap;
                });
            });

        this.normalizeParallelStageGroups();
        this.resolveNodeCollisions();
        this.normalizeParallelStageGroups();
        this.updateWorkspaceBounds();

        if (!silent) {
            this.setBuilderMessage(
                'info',
                'Workflow layout auto-arranged.',
                ['Nodes were spaced out to reduce overlap and make dragging easier.'],
                true,
            );
        }

        if (!suppressRender) {
            this.render();
        }
    }

    getDefaultNodeData(type) {
        switch (type) {
            case 'form':
                return {
                    form_id: null,
                    form_name: 'Select Form',
                    form_builder_url: '#',
                    field_count: 0,
                    fields: [],
                    has_more_fields: false,
                    is_initial: false,
                };
            case 'stage':
                return {
                    stage_id: null,
                    name: 'New Stage',
                    order: 1,
                    approval_logic: 'all',
                    requires_manager_approval: false,
                    allow_send_back: false,
                    allow_reassign: false,
                    allow_edit_form_data: false,
                    approve_label: '',
                    assignee_form_field: '',
                    assignee_lookup_type: 'email',
                    validate_assignee_group: true,
                    trigger_conditions: null,
                    approval_fields: [],
                    approval_groups: [],
                };
            case 'workflow_settings':
                return {
                    name_label: '',
                    requires_approval: true,
                    approval_deadline_days: null,
                    send_reminder_after_days: null,
                    auto_approve_after_days: null,
                    notification_cadence: 'immediate',
                    notification_cadence_day: null,
                    notification_cadence_time: '',
                    notification_cadence_form_field: '',
                    trigger_conditions: null,
                    notification_rules: [],
                };
            case 'condition':
                return {
                    field: '',
                    operator: 'equals',
                    value: '',
                    true_path: '',
                    false_path: ''
                };
            case 'action':
                return {
                    name: 'New Action',
                    action_type: 'database',
                    trigger: 'on_approve',
                    config: {}
                };
            case 'email':
                return {
                    name: 'Send Email',
                    email_to: '',
                    email_to_field: '',
                    email_cc: '',
                    email_cc_field: '',
                    email_subject_template: '',
                    email_body_template: '',
                    email_template_name: '',
                    trigger: 'on_approve'
                };
            case 'sub_workflow':
                return {
                    sub_workflow_def_id: null,
                    sub_workflow_id: null,
                    sub_workflow_form_id: null,
                    sub_workflow_name: '',
                    section_label: '',
                    count_field: '',
                    label_template: 'Sub-workflow {index}',
                    trigger: 'on_approval',
                    data_prefix: '',
                    detached: false,
                    reject_parent: false,
                };
            case 'join':
                return {};
            case 'end':
                return {
                    status: 'approved'
                };
            default:
                return {};
        }
    }

    deleteNode(nodeId) {
        if (confirm('Delete this node?')) {
            this.nodes = this.nodes.filter(n => n.id !== nodeId);
            this.connections = this.connections.filter(c => c.from !== nodeId && c.to !== nodeId);
            this.deselectAll();
            this.render();
        }
    }

    selectNode(nodeId) {
        this.deselectAll();
        this.selectedNode = nodeId;
        this.selectedConnection = null;
        const node = this.nodes.find(n => n.id === nodeId);
        if (node) {
            this.refreshValidationState();
            this.showNodeProperties(node);
        }
        this.updateConnectionSelectionUI();
        this.render();
    }

    deselectAll() {
        this.selectedNode = null;
        this.selectedConnection = null;
        this.showEmptyProperties();
        this.updateConnectionSelectionUI();
        this.render();
    }

    selectConnection(index) {
        if (!this.connections[index]) return;
        this.selectedNode = null;
        this.selectedConnection = index;
        this.showEmptyProperties();
        this.updateConnectionSelectionUI();
        this.render();
    }

    deleteSelectedConnection() {
        if (this.selectedConnection === null || !this.connections[this.selectedConnection]) return;
        this.connections.splice(this.selectedConnection, 1);
        this.selectedConnection = null;
        this.updateConnectionSelectionUI();
        this.render();
    }

    getNodeTypeLabel(type) {
        const labels = {
            start: 'Start',
            form: 'Form Submission',
            workflow_settings: 'Workflow Settings',
            stage: 'Approval Stage',
            condition: 'Condition',
            action: 'Action',
            email: 'Email Notification',
            sub_workflow: 'Sub-Workflow',
            join: 'Join',
            end: 'End'
        };
        return labels[type] || type;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    addNodeIssue(result, nodeId, severity, message) {
        if (!nodeId) return;
        if (!result.nodeIssues[nodeId]) {
            result.nodeIssues[nodeId] = { errors: [], warnings: [] };
        }
        result.nodeIssues[nodeId][severity].push(message);
        result[severity].push(message);
        if (severity === 'errors' && !result.firstErrorNodeId) {
            result.firstErrorNodeId = nodeId;
        }
    }

    refreshValidationState() {
        this.validationState = this.validateWorkflow();
        this.updateValidationDisplay();
        return this.validationState;
    }

    validateWorkflow() {
        const result = {
            errors: [],
            warnings: [],
            nodeIssues: {},
            firstErrorNodeId: null,
        };
        const fieldNames = new Set(this.fields.map(field => field.field_name));
        const fieldIds = new Set(this.fields.map(field => field.id));
        const groupIds = new Set(this.groups.map(group => group.id));
        const stageNodes = this.nodes.filter(node => node.type === 'stage');
        const settingsNode = this.nodes.find(node => node.type === 'workflow_settings');
        const stageNodeIds = new Set(stageNodes.map(node => node.id));
        const assignedApprovalFields = new Map();

        stageNodes.forEach((node, index) => {
            const data = node.data || {};
            const groups = (data.approval_groups || []).filter(group => group && group.id);
            const stageLabel = data.name || `Stage ${index + 1}`;

            if (!String(data.name || '').trim()) {
                this.addNodeIssue(result, node.id, 'errors', `Stage ${index + 1} is missing a name.`);
            }
            if (!(groups.length || data.requires_manager_approval || data.assignee_form_field)) {
                this.addNodeIssue(result, node.id, 'errors', `${stageLabel} needs approval groups, manager approval, or a dynamic assignee field.`);
            }
            if (data.assignee_form_field && !fieldNames.has(data.assignee_form_field)) {
                this.addNodeIssue(result, node.id, 'errors', `${stageLabel} uses an unknown assignee field: ${data.assignee_form_field}.`);
            }
            if (data.validate_assignee_group !== false && data.assignee_form_field && !groups.length) {
                this.addNodeIssue(result, node.id, 'errors', `${stageLabel} cannot validate assignee group membership without at least one approval group.`);
            }
            if (data.approval_logic === 'sequence' && groups.length < 2) {
                this.addNodeIssue(result, node.id, 'warnings', `${stageLabel} uses sequence logic with fewer than two approval groups.`);
            }

            groups.forEach(group => {
                if (!groupIds.has(group.id)) {
                    this.addNodeIssue(result, node.id, 'errors', `${stageLabel} references an unknown approval group: ${group.id}.`);
                }
            });

            (data.approval_fields || []).forEach(field => {
                const fieldId = field?.id;
                const fieldName = field?.field_name;
                const lookupKey = fieldId ? `id:${fieldId}` : `name:${fieldName}`;
                const label = field?.field_label || fieldName || fieldId;
                const exists = (fieldId && fieldIds.has(fieldId)) || (fieldName && fieldNames.has(fieldName));

                if (!exists) {
                    this.addNodeIssue(result, node.id, 'errors', `${stageLabel} references an unknown approval-only field: ${label}.`);
                    return;
                }

                if (assignedApprovalFields.has(lookupKey) && assignedApprovalFields.get(lookupKey) !== node.id) {
                    const otherStage = this.nodes.find(candidate => candidate.id === assignedApprovalFields.get(lookupKey));
                    const otherLabel = otherStage?.data?.name || 'another stage';
                    this.addNodeIssue(result, node.id, 'errors', `Approval-only field ${label} is already assigned to ${otherLabel}.`);
                } else {
                    assignedApprovalFields.set(lookupKey, node.id);
                }
            });
        });

        if (settingsNode) {
            const data = settingsNode.data || {};
            const cadence = data.notification_cadence || 'immediate';
            const cadenceDay = data.notification_cadence_day;

            if (cadence === 'weekly' && !(Number.isInteger(cadenceDay) && cadenceDay >= 0 && cadenceDay <= 6)) {
                this.addNodeIssue(result, settingsNode.id, 'errors', 'Weekly notification cadence requires a digest day between 0 and 6.');
            }
            if (cadence === 'monthly' && !(Number.isInteger(cadenceDay) && cadenceDay >= 1 && cadenceDay <= 31)) {
                this.addNodeIssue(result, settingsNode.id, 'errors', 'Monthly notification cadence requires a digest day between 1 and 31.');
            }
            if (cadence === 'form_field_date') {
                if (!data.notification_cadence_form_field) {
                    this.addNodeIssue(result, settingsNode.id, 'errors', 'On-date notification cadence requires a date field.');
                } else if (!fieldNames.has(data.notification_cadence_form_field)) {
                    this.addNodeIssue(result, settingsNode.id, 'errors', `Unknown notification cadence field: ${data.notification_cadence_form_field}.`);
                }
            }
            if (cadence !== 'weekly' && cadence !== 'monthly' && data.notification_cadence_day !== null && data.notification_cadence_day !== '') {
                this.addNodeIssue(result, settingsNode.id, 'warnings', 'Digest day is only used for weekly and monthly notification cadences.');
            }
            if (cadence !== 'form_field_date' && data.notification_cadence_form_field) {
                this.addNodeIssue(result, settingsNode.id, 'warnings', 'Date field is ignored unless cadence is “On Date From Form Field”.');
            }

            (data.notification_rules || []).forEach((rule, index) => {
                const ruleLabel = `Notification rule ${index + 1}`;
                const hasRecipients = Boolean(
                    rule.notify_submitter
                    || rule.email_field
                    || rule.static_emails
                    || rule.notify_stage_assignees
                    || rule.notify_stage_groups
                    || (rule.notify_groups || []).length
                );
                if (!hasRecipients) {
                    this.addNodeIssue(result, settingsNode.id, 'errors', `${ruleLabel} must define at least one recipient source.`);
                }
                if (rule.email_field && !fieldNames.has(rule.email_field)) {
                    this.addNodeIssue(result, settingsNode.id, 'errors', `${ruleLabel} references an unknown email field: ${rule.email_field}.`);
                }
                if (rule.stage_node_id && !stageNodeIds.has(rule.stage_node_id)) {
                    this.addNodeIssue(result, settingsNode.id, 'errors', `${ruleLabel} references a stage that is not present in the builder graph.`);
                }
                if ((rule.notify_stage_assignees || rule.notify_stage_groups) && !stageNodes.length) {
                    this.addNodeIssue(result, settingsNode.id, 'warnings', `${ruleLabel} uses stage-based recipients, but no approval stages are configured yet.`);
                }
            });
        }

        this.nodes.filter(node => node.type === 'email').forEach((node, index) => {
            const data = node.data || {};
            const label = data.name || `Email notification ${index + 1}`;
            if (!(data.email_to || data.email_to_field)) {
                this.addNodeIssue(result, node.id, 'errors', `${label} needs static recipients or a recipient field.`);
            }
            if (data.email_to_field && !fieldNames.has(data.email_to_field)) {
                this.addNodeIssue(result, node.id, 'errors', `${label} references an unknown recipient field: ${data.email_to_field}.`);
            }
            if (data.email_cc_field && !fieldNames.has(data.email_cc_field)) {
                this.addNodeIssue(result, node.id, 'errors', `${label} references an unknown CC field: ${data.email_cc_field}.`);
            }
        });

        this.nodes.filter(node => node.type === 'action').forEach((node, index) => {
            const data = node.data || {};
            if (typeof data.config === 'string' && data.config.trim()) {
                try {
                    JSON.parse(data.config);
                } catch (_error) {
                    this.addNodeIssue(result, node.id, 'errors', `${data.name || `Action ${index + 1}`} has invalid JSON configuration.`);
                }
            }
        });

        this.nodes.filter(node => node.type === 'sub_workflow').forEach((node, index) => {
            const data = node.data || {};
            const label = data.sub_workflow_name || `Sub-workflow ${index + 1}`;
            if (!data.sub_workflow_id) {
                this.addNodeIssue(result, node.id, 'errors', `${label} needs a target workflow.`);
            }
            if (data.count_field && !fieldNames.has(data.count_field)) {
                this.addNodeIssue(result, node.id, 'errors', `${label} references an unknown count field: ${data.count_field}.`);
            }
            if (data.detached && data.reject_parent) {
                this.addNodeIssue(result, node.id, 'warnings', `${label} is detached, so “Reject Parent on Failure” may not have any effect.`);
            }
        });

        return result;
    }

    getNodeIssues(nodeId) {
        return this.validationState.nodeIssues[nodeId] || { errors: [], warnings: [] };
    }

    usesDirectionalHandles(nodeType) {
        return ['stage', 'sub_workflow'].includes(nodeType);
    }

    buildNodeIssuesAlert(node) {
        const issues = this.getNodeIssues(node.id);
        if (!issues.errors.length && !issues.warnings.length) {
            return '';
        }

        const errorHtml = issues.errors.length ? `
            <div class="alert alert-danger py-2 px-3">
                <div class="fw-semibold mb-1"><i class="bi bi-exclamation-triangle"></i> Fix before saving</div>
                <ul class="small mb-0">
                    ${issues.errors.map(error => `<li>${this.escapeHtml(error)}</li>`).join('')}
                </ul>
            </div>
        ` : '';
        const warningHtml = issues.warnings.length ? `
            <div class="alert alert-warning py-2 px-3 ${issues.errors.length ? 'mt-2' : ''}">
                <div class="fw-semibold mb-1"><i class="bi bi-exclamation-circle"></i> Warnings</div>
                <ul class="small mb-0">
                    ${issues.warnings.map(warning => `<li>${this.escapeHtml(warning)}</li>`).join('')}
                </ul>
            </div>
        ` : '';
        return `${errorHtml}${warningHtml}`;
    }

    buildNodeIssueBadges(nodeId) {
        const issues = this.getNodeIssues(nodeId);
        if (!issues.errors.length && !issues.warnings.length) {
            return '';
        }

        return `
            <div class="node-issue-badges mt-2">
                ${issues.errors.length ? `<span class="badge bg-danger-subtle text-danger-emphasis">${issues.errors.length} error${issues.errors.length === 1 ? '' : 's'}</span>` : ''}
                ${issues.warnings.length ? `<span class="badge bg-warning-subtle text-warning-emphasis">${issues.warnings.length} warning${issues.warnings.length === 1 ? '' : 's'}</span>` : ''}
            </div>
        `;
    }

    buildPropertySection(title, innerHtml, options = {}) {
        const description = options.description ? `
            <p class="property-section-description">${this.escapeHtml(options.description)}</p>
        ` : '';
        const icon = options.icon ? `<i class="bi bi-${options.icon}"></i>` : '';
        return `
            <section class="property-section ${options.className || ''}">
                <div class="property-section-header">
                    <h6>${icon}<span>${this.escapeHtml(title)}</span></h6>
                    ${description}
                </div>
                <div class="property-section-body">
                    ${innerHtml}
                </div>
            </section>
        `;
    }

    render() {
        console.log('Rendering workflow with', this.nodes.length, 'nodes and', this.connections.length, 'connections');
        this.refreshValidationState();
        if (this.selectedConnection !== null && !this.connections[this.selectedConnection]) {
            this.selectedConnection = null;
        }
        this.updateWorkspaceBounds();
        this.renderNodes();
        this.renderConnections();
        this.applyTransform();
        this.updateConnectionSelectionUI();
        this.updateDirtyState();
    }

    renderNodes() {
        console.log('Rendering nodes...');
        // Remove existing nodes
        this.transformWrapper.querySelectorAll('.workflow-node').forEach(n => n.remove());

        // Render each node into the transform wrapper (alongside the SVG)
        const orderedNodes = [...this.nodes].sort((a, b) => {
            return (this.nodeStackOrder.get(a.id) || 0) - (this.nodeStackOrder.get(b.id) || 0);
        });
        orderedNodes.forEach(node => {
            console.log('Creating node element for:', node);
            const nodeEl = this.createNodeElement(node);
            this.transformWrapper.appendChild(nodeEl);
        });
        console.log('Nodes rendered');
    }

    createNodeElement(node) {
        // Ensure node.data exists (may be missing from saved workflow data)
        if (!node.data) {
            node.data = this.getDefaultNodeData(node.type);
        }

        const div = document.createElement('div');
        div.className = `workflow-node ${node.type}`;
        div.dataset.nodeId = node.id;
        const issues = this.getNodeIssues(node.id);
        if (issues.errors.length) {
            div.className += ' has-validation-error';
        } else if (issues.warnings.length) {
            div.className += ' has-validation-warning';
        }
        if (this.selectedNode === node.id) {
            div.className += ' selected';
        }
        if (this.draggingNodeId === node.id) {
            div.className += ' dragging';
        }
        div.style.left = `${node.x}px`;
        div.style.top = `${node.y}px`;
        div.dataset.nodeId = node.id;

        const icon = this.getNodeIcon(node.type);
        const label = node.data.step_name || node.data.name || this.getNodeTypeLabel(node.type);

        // Determine if node can be deleted
        // - start, workflow_settings: never deletable
        // - form: only deletable if it's an additional form (is_initial === false)
        // - stage: always deletable
        // - all others: deletable
        const canDelete = node.type !== 'start' &&
                         node.type !== 'workflow_settings' &&
                         node.type !== 'join' &&
                         !(node.type === 'form' && node.data.is_initial !== false);
        const directionalHandles = this.usesDirectionalHandles(node.type);
        const inputHandleTitle = directionalHandles
            ? 'Incoming connection'
            : 'Connect previous step here';
        const outputHandleTitle = directionalHandles
            ? 'Drag to next step'
            : 'Drag to connect next step';

        div.innerHTML = `
            <div class="node-header">
                <div class="node-icon ${node.type}">
                    <i class="bi bi-${icon}"></i>
                </div>
                <span>${this.escapeHtml(label)}</span>
            </div>
            <div class="node-content">
                ${this.getNodeDescription(node)}
                ${this.buildNodeIssueBadges(node.id)}
            </div>
            ${canDelete ? `
                <div class="node-actions">
                    <button class="btn btn-sm btn-outline-danger" onclick="workflowBuilder.deleteNode('${node.id}')">
                        <i class="bi bi-trash"></i>
                    </button>
                </div>
            ` : ''}
            <div class="connection-point input ${directionalHandles ? 'directional-handle' : ''}" data-node-id="${node.id}" data-point="input" title="${inputHandleTitle}"></div>
            <div class="connection-point output ${directionalHandles ? 'directional-handle' : ''}" data-node-id="${node.id}" data-point="output" title="${outputHandleTitle}"></div>
        `;

        // Add connection point event listeners
        const inputPoint = div.querySelector('.connection-point.input');
        const outputPoint = div.querySelector('.connection-point.output');

        if (outputPoint) {
            outputPoint.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                this.startConnection(e, node.id, 'output');
            });
        }

        if (inputPoint) {
            inputPoint.addEventListener('mouseenter', (e) => {
                if (this.isConnecting) {
                    inputPoint.classList.add('is-connect-target');
                }
            });
            inputPoint.addEventListener('mouseleave', (e) => {
                inputPoint.classList.remove('is-connect-target');
            });
        }

        // Make node draggable
        div.addEventListener('mousedown', (e) => {
            if (e.target.closest('.node-actions')) return;
            if (e.target.closest('.connection-point')) return;
            if (e.target.closest('.form-edit-link')) return; // Don't interfere with form edit link

            this.selectNode(node.id);
            this.startDragNode(e, node);
        });

        return div;
    }

    getNodeIcon(type) {
        const icons = {
            start: 'play-circle',
            form: 'file-earmark-text',
            workflow_settings: 'gear',
            stage: 'layers',
            condition: 'diagram-3',
            action: 'lightning',
            email: 'envelope',
            sub_workflow: 'diagram-2',
            join: 'sign-merge-right',
            end: 'flag'
        };
        return icons[type] || 'circle';
    }

    getNodeDescription(node) {
        switch (node.type) {
            case 'start':
                return 'Workflow starts here';
            case 'form':
                const fieldCount = node.data.field_count || 0;
                const isInitial = node.data.is_initial !== false;
                const isMultiStep = node.data.enable_multi_step && node.data.step_count > 0;

                // Show different description for initial vs additional forms
                if (!isInitial && !node.data.form_id) {
                    return '<span class="badge bg-secondary"><i class="bi bi-exclamation-circle"></i> No Form Selected</span><br><small class="text-muted">Select a form in properties</small>';
                }

                let badges = '';
                if (!isInitial) {
                    badges += '<span class="badge bg-info">Additional Step</span> ';
                }
                if (isMultiStep) {
                    badges += `<span class="badge bg-success"><i class="bi bi-list-ol"></i> ${node.data.step_count} Steps</span> `;
                }

                const badgeHtml = badges ? `${badges}<br>` : '';
                return `${badgeHtml}${fieldCount} field${fieldCount !== 1 ? 's' : ''} • <a href="${node.data.form_builder_url || '#'}" target="_blank" class="text-primary form-edit-link"><i class="bi bi-pencil-square"></i> Edit Form</a>`;
            case 'workflow_settings':
                const parts_ws = [];
                if (node.data.name_label) parts_ws.push(this.escapeHtml(node.data.name_label));
                if (node.data.approval_deadline_days) parts_ws.push(`Deadline: ${node.data.approval_deadline_days}d`);
                if (node.data.notification_cadence && node.data.notification_cadence !== 'immediate') parts_ws.push(`Cadence: ${this.escapeHtml(node.data.notification_cadence)}`);
                if (node.data.notification_cadence_form_field && node.data.notification_cadence === 'form_field_date') parts_ws.push(`Date field: ${this.escapeHtml(node.data.notification_cadence_form_field)}`);
                if (node.data.notification_rules && node.data.notification_rules.length > 0) parts_ws.push(`Notifications: ${node.data.notification_rules.length}`);
                if (node.data.trigger_conditions && node.data.trigger_conditions.conditions && node.data.trigger_conditions.conditions.length > 0) parts_ws.push('Conditional');
                return parts_ws.length > 0 ?
                    `<small class="text-muted">${parts_ws.join(' • ')}</small>` :
                    '<small class="text-muted">Default settings</small>';
            case 'stage':
                const stageParts = [];
                if (node.data.requires_manager_approval) stageParts.push('Manager');
                if (node.data.allow_send_back) stageParts.push('Send Back target');
                if (node.data.allow_reassign) stageParts.push('Reassign');
                if (node.data.allow_edit_form_data) stageParts.push('Editable');
                if (node.data.assignee_form_field) stageParts.push(`Dynamic: ${this.escapeHtml(node.data.assignee_form_field)}`);
                if (node.data.approval_fields && node.data.approval_fields.length > 0) stageParts.push(`Stage fields: ${node.data.approval_fields.length}`);
                if (node.data.trigger_conditions && node.data.trigger_conditions.conditions && node.data.trigger_conditions.conditions.length > 0) stageParts.push('Conditional');
                if (node.data.approval_groups && node.data.approval_groups.length > 0) {
                    const gc = node.data.approval_groups.length;
                    stageParts.push(`${gc} group${gc > 1 ? 's' : ''} (${this.escapeHtml(node.data.approval_logic || 'all')})`);
                }
                const label = node.data.approve_label ? ` • "${this.escapeHtml(node.data.approve_label)}"` : '';
                return stageParts.length > 0 ?
                    `<span class="badge bg-warning">Stage ${node.data.order || '?'}</span><br><small class="text-muted">${stageParts.join(' + ')}${label}</small>` :
                    `<span class="badge bg-secondary">Stage ${node.data.order || '?'}</span><br><small class="text-muted">No approvers configured</small>`;
            case 'condition':
                if (node.data.field && node.data.operator) {
                    const operatorSymbols = {
                        'equals': '=',
                        'not_equals': '≠',
                        'greater_than': '>',
                        'less_than': '<',
                        'greater_or_equal': '≥',
                        'less_or_equal': '≤',
                        'contains': 'contains',
                        'not_contains': 'not contains',
                        'is_empty': 'is empty',
                        'not_empty': 'is not empty'
                    };
                    const op = operatorSymbols[node.data.operator] || node.data.operator;
                    return `If ${this.escapeHtml(node.data.field)} ${this.escapeHtml(op)} ${this.escapeHtml(node.data.value || '')}`;
                }
                return 'Configure condition';
            case 'action':
                return node.data.action_type ? `${this.escapeHtml(node.data.action_type.toUpperCase())}: ${this.escapeHtml(node.data.trigger || '')}` : 'Configure action';
            case 'email':
                if (node.data.email_to && node.data.email_to_field) return `Send to: ${this.escapeHtml(node.data.email_to)} + field ${this.escapeHtml(node.data.email_to_field)}`;
                if (node.data.email_to) return `Send to: ${this.escapeHtml(node.data.email_to)}`;
                if (node.data.email_to_field) return `Send to field: ${this.escapeHtml(node.data.email_to_field)}`;
                return 'Configure email';
            case 'join':
                return '<small class="text-muted">Parallel stages merge here</small>';
            case 'sub_workflow':
                const swParts = [];
                if (node.data.sub_workflow_name) swParts.push(this.escapeHtml(node.data.sub_workflow_name));
                if (node.data.count_field) swParts.push(`Count: ${this.escapeHtml(node.data.count_field)}`);
                if (node.data.trigger) swParts.push(node.data.trigger === 'on_approval' ? 'After approval' : 'On submission');
                if (node.data.detached) swParts.push('Detached');
                if (node.data.reject_parent) swParts.push('Rejects parent');
                return swParts.length > 0 ?
                    `<span class="badge bg-info">Sub-Workflow</span><br><small class="text-muted">${swParts.join(' • ')}</small>` :
                    '<span class="badge bg-secondary">Sub-Workflow</span><br><small class="text-muted">Not configured</small>';
            case 'end':
                return 'Workflow end';
            default:
                return '';
        }
    }

    startDragNode(e, node) {
        if (e.button !== 0) return;

        e.preventDefault();
        this.isDraggingNode = true;
        this.draggingNodeId = node.id;
        this.bringNodeToFront(node.id);
        this.render();
        const [startCanvasX, startCanvasY] = this.clientToCanvas(e.clientX, e.clientY);
        const dragOffsetX = startCanvasX - node.x;
        const dragOffsetY = startCanvasY - node.y;

        const onMouseMove = (e) => {
            const [canvasX, canvasY] = this.clientToCanvas(e.clientX, e.clientY);
            node.x = canvasX - dragOffsetX;
            node.y = canvasY - dragOffsetY;
            this.render();
        };

        const onMouseUp = () => {
            this.isDraggingNode = false;
            this.draggingNodeId = null;
            this.render();
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }

    startConnection(e, nodeId, point) {
        if (point !== 'output') return; // Only start from output

        e.stopPropagation();
        e.preventDefault();
        this.isConnecting = true;
        this.connectionStart = { nodeId, point };

        console.log('Starting connection from node:', nodeId);

        const onMouseMove = (e) => {
            this.updateTempConnection(e);
        };

        const onMouseUp = (e) => {
            this.finishConnection(e);
            this.isConnecting = false;
            this.connectionStart = null;
            if (this.tempLine) {
                this.tempLine.remove();
                this.tempLine = null;
            }
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }

    updateTempConnection(e) {
        const [x, y] = this.clientToCanvas(e.clientX, e.clientY);
        const startPoint = this.getConnectionPointPosition(this.connectionStart.nodeId, 'output');
        if (!startPoint) return;

        this.updateWorkspaceBounds([startPoint, { x, y }]);

        if (!this.tempLine) {
            this.tempLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            this.tempLine.setAttribute('class', 'connection-line');
            this.tempLine.setAttribute('stroke-dasharray', '5,5');
            this.svg.appendChild(this.tempLine);
        }

        const path = this.createConnectionPath(
            startPoint.x, startPoint.y,
            x, y
        );
        this.tempLine.setAttribute('d', path);
    }

    finishConnection(e) {
        console.log('Finishing connection, event target:', e.target);
        const target = e.target.closest('.connection-point');
        console.log('Connection point target:', target);

        if (!target || target.dataset.point !== 'input') {
            console.log('Not a valid input connection point');
            return;
        }

        const toNodeId = target.dataset.nodeId;
        console.log('Connecting to node:', toNodeId);

        if (toNodeId === this.connectionStart.nodeId) {
            console.log('Cannot connect to self');
            return; // Can't connect to self
        }

        // Check if connection already exists
        const exists = this.connections.some(c =>
            c.from === this.connectionStart.nodeId && c.to === toNodeId
        );

        if (!exists) {
            console.log('Creating new connection');
            this.connections = [...this.connections, {
                from: this.connectionStart.nodeId,
                to: toNodeId
            }];
            this.selectedConnection = this.connections.length - 1;
            this.updateConnectionSelectionUI();
            this.render();
        } else {
            console.log('Connection already exists');
        }
    }

    renderConnections() {
        // Remove existing connections
        this.svg.querySelectorAll('.connection-line:not([stroke-dasharray]), .connection-backdrop, .connection-hitbox').forEach(l => l.remove());

        // Render each connection
        this.connections.forEach((conn, index) => {
            const fromPoint = this.getConnectionPointPosition(conn.from, 'output');
            const toPoint = this.getConnectionPointPosition(conn.to, 'input');
            if (!fromPoint || !toPoint) return;

            const path = this.createConnectionPath(
                fromPoint.x, fromPoint.y,
                toPoint.x, toPoint.y
            );

            const backdrop = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            backdrop.setAttribute('class', 'connection-backdrop');
            backdrop.setAttribute('d', path);
            this.svg.appendChild(backdrop);

            const hitbox = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            hitbox.setAttribute('class', 'connection-hitbox');
            hitbox.setAttribute('d', path);

            const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            line.setAttribute('class', 'connection-line');
            line.setAttribute('data-connection-index', index);
            line.setAttribute('d', path);

            const setHover = (isHovered) => {
                line.classList.toggle('hovered', isHovered);
                backdrop.classList.toggle('hovered', isHovered);
            };

            const selectConnection = (e) => {
                e.stopPropagation();
                this.selectConnection(index);
            };

            if (this.selectedConnection === index) {
                line.classList.add('selected');
                backdrop.classList.add('selected');
            }

            line.addEventListener('click', selectConnection);
            hitbox.addEventListener('click', selectConnection);
            line.addEventListener('mouseenter', () => setHover(true));
            hitbox.addEventListener('mouseenter', () => setHover(true));
            line.addEventListener('mouseleave', () => setHover(false));
            hitbox.addEventListener('mouseleave', () => setHover(false));

            this.svg.appendChild(line);
            this.svg.appendChild(hitbox);
        });
    }

    getConnectionPointPosition(nodeId, pointType) {
        const nodeElement = this.transformWrapper.querySelector(`.workflow-node[data-node-id="${nodeId}"]`);
        if (!nodeElement) return null;

        const pointElement = nodeElement.querySelector(`.connection-point.${pointType}`);
        if (!pointElement) return null;

        const wrapperRect = this.transformWrapper.getBoundingClientRect();
        const pointRect = pointElement.getBoundingClientRect();
        return {
            x: (pointRect.left - wrapperRect.left + pointRect.width / 2) / this.zoom,
            y: (pointRect.top - wrapperRect.top + pointRect.height / 2) / this.zoom,
        };
    }

    createConnectionPath(x1, y1, x2, y2) {
        const dx = x2 - x1;
        const curve = Math.min(220, Math.max(60, Math.abs(dx) * 0.45 + (dx < 0 ? 70 : 0)));
        const cx1 = x1 + curve;
        const cx2 = x2 - curve;

        return `M ${x1} ${y1} C ${cx1} ${y1}, ${cx2} ${y2}, ${x2} ${y2}`;
    }
}

Object.assign(WorkflowBuilder.prototype, apiMethods, propertyEditorMethods);
