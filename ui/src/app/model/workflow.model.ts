import { AsCodeEvents } from 'app/model/ascode.model';
import { Permission } from 'app/model/permission.model';
import { Application } from './application.model';
import { AuditWorkflow } from './audit.model';
import { Environment } from './environment.model';
import { GroupPermission } from './group.model';
import { ProjectIntegration } from './integration.model';
import { Parameter } from './parameter.model';
import { Pipeline } from './pipeline.model';
import { Label } from './project.model';
import { Usage } from './usage.model';
import { WorkflowTemplateInstance } from './workflow-template.model';
import { WorkflowHookModel } from './workflow.hook.model';
import { WorkflowRun } from './workflow.run.model';

// Node type enum
export class WNodeType {
    static PIPELINE = 'pipeline';
    static JOIN = 'join';
    static FORK = 'fork';
    static OUTGOINGHOOK = 'outgoinghook';
}

export class WorkflowProjectIntegration {
    id: number;
    project_integration_id: number;
    workflow_id: number;
    project_integration: ProjectIntegration;
}

// Workflow represents a pipeline based workflow
export class Workflow {
    id: number;
    name: string;
    description: string;
    icon: string;
    project_id: number;
    project_key: string;
    last_modified: string;
    groups: Array<GroupPermission>;
    permissions: Permission;
    metadata: Map<string, string>;
    usage: Usage;
    history_length: number;
    purge_tags: Array<string>;
    notifications: Array<WorkflowNotification>;
    from_repository: string;
    from_template: string;
    template_instance: WorkflowTemplateInstance;
    template_up_to_date: boolean;
    pipelines: { [key: number]: Pipeline; };
    applications: { [key: number]: Application; };
    environments: { [key: number]: Environment; };
    project_integrations: { [key: number]: ProjectIntegration; };
    integrations: WorkflowProjectIntegration[];
    hook_models: { [key: number]: WorkflowHookModel; };
    outgoing_hook_models: { [key: number]: WorkflowHookModel; };
    labels: Label[];
    workflow_data: WorkflowData;
    as_code_events: Array<AsCodeEvents>;
    retention_policy: string;
    max_runs: number;
    organization: string;

    preview: Workflow;
    asCode: string;
    audits: AuditWorkflow[];

    // UI params
    externalChange: boolean;
    forceRefresh: boolean;
    previewMode: boolean;

    constructor() {
        this.workflow_data = new WorkflowData();
    }

    static getAllNodes(data: Workflow): Array<WNode> {
        let nodes = WNode.getAllNodes(data.workflow_data.node);

        if (data.workflow_data.joins) {
            data.workflow_data.joins.forEach(j => {
                nodes.push(...WNode.getAllNodes(j));
            });
        }
        return nodes;
    }

    static getHookByRef(ref: string, w: Workflow): WNodeHook {
        let hook = WNode.getHookByRef(w.workflow_data.node, ref);
        if (hook) {
            return hook;
        }
        if (w.workflow_data.joins) {
            for (let i = 0; i < w.workflow_data.joins.length; i++) {
                let h = WNode.getHookByRef(w.workflow_data.joins[i], ref);
                if (h) {
                    return h;
                }
            }
        }
        return null;
    }

    static getNodeByRef(ref: string, w: Workflow): WNode {
        let node = WNode.getNodeByRef(w.workflow_data.node, ref);
        if (node) {
            return node;
        }
        if (w.workflow_data.joins) {
            for (let i = 0; i < w.workflow_data.joins.length; i++) {
                let n = WNode.getNodeByRef(w.workflow_data.joins[i], ref);
                if (n) {
                    return n;
                }
            }
        }
        return null;
    }

    static getNodeByID(id: number, w: Workflow): WNode {
        let node = WNode.getNodeByID(w.workflow_data.node, id);
        if (node) {
            return node;
        }
        if (w.workflow_data.joins) {
            for (let i = 0; i < w.workflow_data.joins.length; i++) {
                let n = WNode.getNodeByID(w.workflow_data.joins[i], id);
                if (n) {
                    return n;
                }
            }
        }
        return null;
    }

    static removeNodeWithChild(w: Workflow, nodeID: number): boolean {
        let result = false;
        // Cannot remove root node
        if (nodeID === w.workflow_data.node.id) {
            return false;
        }
        let nodeDeleted = WNode.removeNodeWithChild(null, w.workflow_data.node, nodeID, 0);
        if (!nodeDeleted) {
            if (w.workflow_data.joins) {
                for (let i = 0; i < w.workflow_data.joins.length; i++) {
                    if (w.workflow_data.joins[i].id === nodeID) {
                        w.workflow_data.joins.splice(i, 1);
                        result = true;
                        break;
                    }
                    let bb = WNode.removeNodeWithChild(null, w.workflow_data.joins[i], nodeID, i);
                    if (bb) {
                        result = true;
                        break;
                    }
                }
            }
        } else {
            result = true;
        }
        if (result) {
            let nodes = Workflow.getAllNodes(w);
            Workflow.cleanJoin(w, nodes);
            Workflow.cleanNotifications(w, nodes);
        }
        return result;
    }

    static removeNodeOnly(w: Workflow, nodeID: number): boolean {
        let result = false;
        if (nodeID === w.workflow_data.node.id && w.workflow_data.node.triggers.length > 0) {
            // Replace node by a fork
            let newRoot = new WNode();
            newRoot.triggers = w.workflow_data.node.triggers;
            newRoot.type = WNodeType.FORK;
            newRoot.hooks = w.workflow_data.node.hooks;
            newRoot.workflow_id = w.workflow_data.node.workflow_id;
            w.workflow_data.node = newRoot;
            result = true;
        }
        if (!result) {
            let nodeDeleted = WNode.removeNodeOnly(w, null, w.workflow_data.node, nodeID, -1);
            if (nodeDeleted) {
                result = true;
            }
            if (!result && w.workflow_data.joins) {
                for (let i = 0; i < w.workflow_data.joins.length; i++) {
                    let joinDeleted = WNode.removeNodeOnly(w, null, w.workflow_data.joins[i], nodeID, i);
                    if (joinDeleted) {
                        result = true;
                        break;
                    }
                }
            }
        }
        if (result) {
            let nodes = Workflow.getAllNodes(w);
            Workflow.cleanJoin(w, nodes);
            Workflow.cleanNotifications(w, nodes);
        }

        return result;
    }

    static cleanNotifications(workflow: Workflow, nodes: Array<WNode>) {
        if (workflow.notifications && workflow.notifications.length > 0) {
            for (let i = 0; i < workflow.notifications.length; i++) {
                if (workflow.notifications[i].source_node_ref) {
                    for (let j = 0; j < workflow.notifications[i].source_node_ref.length; j++) {
                        if (-1 === nodes.findIndex(n => n.ref === workflow.notifications[i].source_node_ref[j]) &&
                            -1 === nodes.findIndex(n => n.name === workflow.notifications[i].source_node_ref[j])) {
                            workflow.notifications[i].source_node_ref.splice(j, 1);
                            j--;
                        }
                    }
                    if (workflow.notifications[i].source_node_ref.length === 0) {
                        workflow.notifications.splice(i, 1);
                        i--;
                    }
                }
            }
        }
    }

    static cleanJoin(workflow: Workflow, nodes: Array<WNode>) {
        if (workflow.workflow_data.joins) {
            for (let i = 0; i < workflow.workflow_data.joins.length; i++) {
                if (workflow.workflow_data.joins[i].parents && workflow.workflow_data.joins[i].parents.length > 0) {
                    for (let j = 0; j < workflow.workflow_data.joins[i].parents.length; j++) {
                        if (-1 === nodes.findIndex(n => n.id === workflow.workflow_data.joins[i].parents[j].parent_id)) {
                            workflow.workflow_data.joins[i].parents.splice(j, 1);
                            j--;
                        }
                    }
                }
                if (workflow.workflow_data.joins[i].parents.length === 0) {
                    workflow.workflow_data.joins.splice(i, 1);
                    i--;
                }
            }
        }
    }

    static getMapNodes(data: Workflow): Map<number, WNode> {
        let nodes = new Map<number, WNode>();
        nodes = WNode.getMapNodes(nodes, data.workflow_data.node);

        if (data.workflow_data.joins) {
            data.workflow_data.joins.forEach(() => {
                nodes = WNode.getMapNodes(nodes, data.workflow_data.node);
            });
        }
        return nodes;
    }

    static getMapNodesRef(data: Workflow): Map<string, WNode> {
        let nodes = new Map<string, WNode>();
        nodes = WNode.getMapNodesRef(nodes, data.workflow_data.node);

        if (data.workflow_data.joins) {
            data.workflow_data.joins.forEach(j => {
                nodes = WNode.getMapNodesRef(nodes, j);
            });
        }
        return nodes;
    }

    static prepareRequestForAPI(workflow: Workflow) {
        WNode.prepareRequestForAPI(workflow.workflow_data.node);
        if (workflow.workflow_data.joins) {
            workflow.workflow_data.joins.forEach(j => {
                j.id = 0;
                if (j.triggers) {
                    j.triggers.forEach(t => {
                        WNode.prepareRequestForAPI(t.child_node);
                    });
                }
            });
        }
        delete workflow.usage;
        delete workflow.applications;
        delete workflow.environments;
        delete workflow.pipelines;
        delete workflow.project_integrations;
        delete workflow.hook_models;
        delete workflow.outgoing_hook_models;
    }

    static getPipeline(workflow: Workflow, node: WNode): Pipeline {
        if (node.context && node.context.pipeline_id) {
            return workflow.pipelines[node.context.pipeline_id];
        }
    }
    static getApplication(workflow: Workflow, node: WNode): Application {
        if (node.context && node.context.application_id) {
            return workflow.applications[node.context.application_id];
        }
    }

    static getNodeNameImpact(workflow: Workflow, name: string): WorkflowPipelineNameImpact {
        let warnings = new WorkflowPipelineNameImpact();
        WNode.getNodeNameImpact(workflow.workflow_data.node, name, warnings);
        if (workflow.workflow_data.joins) {
            workflow.workflow_data.joins.forEach(j => {
                WNode.getNodeNameImpact(j, name, warnings);
            });
        }
        return warnings;
    }

    static getAllHooks(workflow: Workflow): Array<WNodeHook> {
        let res = WNode.getAllHooks(workflow.workflow_data.node);
        if (workflow.workflow_data.joins) {
            workflow.workflow_data.joins.forEach(j => {
                if (j.triggers) {
                    j.triggers.forEach(t => {
                        let hooks = WNode.getAllHooks(t.child_node);
                        if (hooks) {
                            res = res.concat(hooks);
                        }
                    });
                }
            });
        }
        return res;
    }

    static getParentNodeIds(workflowRun: WorkflowRun, currentNodeID: number): number[] {
        let ancestors = new Array<number>();
        let nodes = Workflow.getAllNodes(workflowRun.workflow);
        if (nodes) {
            loop: for (let i = 0; i < nodes.length; i++) {
                let n = nodes[i];
                if (n.triggers) {
                    for (let j = 0; j < n.triggers.length; j++) {
                        let t = n.triggers[j];
                        if (t.child_node.id === currentNodeID) {
                            ancestors.push(n.id);
                            break loop;
                        }
                    }
                }
                if (n.id === currentNodeID && n.type === WNodeType.JOIN) {
                    ancestors.push(...n.parents.map(p => p.parent_id));
                }
            }
        }
        return ancestors;
    }
}

export class WorkflowPipelineNameImpact {
    nodes = new Array<WNode>();
}

export class WorkflowNodeHookConfigValue {
    value: string;
    configurable: boolean;
    type: string;
    multiple_choice_list: Array<string>;
}

// WorkflowTriggerConditions is either a lua script to check conditions or a set of WorkflowTriggerCondition
export class WorkflowNodeConditions {
    lua_script: string;
    plain: Array<WorkflowNodeCondition>;
}

// WorkflowTriggerCondition represents a condition to trigger ot not a pipeline in a workflow. Operator can be =, !=, regex
export class WorkflowNodeCondition {
    variable: string;
    operator: string;
    value: any;

    constructor() {
        this.value = '';
    }
}

export class WorkflowTriggerConditionCache {
    operators: Array<string>;
    names: Array<string>;
}

export class WorkflowNotification {
    id: number;
    node_id: Array<number>;
    source_node_ref: Array<string>;
    type: string;
    settings: UserNotificationSettings;

    constructor() {
        this.type = notificationTypes[0];
        this.settings = new UserNotificationSettings();
        this.source_node_ref = new Array<string>();
        this.node_id = new Array<number>();
    }
}

export class WorkflowData {
    node: WNode;
    joins: Array<WNode>;
}

export class WNode {
    id: number;
    workflow_id: number;
    name: string;
    ref: string;
    type: string;
    triggers: Array<WNodeTrigger>;
    context: WNodeContext;
    outgoing_hook: WNodeOutgoingHook;
    parents: Array<WNodeJoin>;
    hooks: Array<WNodeHook>;
    groups: Array<GroupPermission>;

    constructor() {
        this.context = new WNodeContext();
    }

    static getMapNodes(nodes: Map<number, WNode>, node: WNode): Map<number, WNode> {
        nodes.set(node.id, node);
        if (node.triggers) {
            node.triggers.forEach(t => {
                nodes = WNode.getMapNodes(nodes, t.child_node);
            });
        }
        return nodes;
    }

    static getMapNodesRef(nodes: Map<string, WNode>, node: WNode): Map<string, WNode> {
        nodes.set(node.ref, node);
        if (node.triggers) {
            node.triggers.forEach(t => {
                nodes = WNode.getMapNodesRef(nodes, t.child_node);
            });
        }
        return nodes;
    }

    static getHookByRef(node: WNode, ref: string): WNodeHook {
        if (node.hooks) {
            for (let i = 0; i < node.hooks.length; i++) {
                if (node.hooks[i].ref === ref) {
                    return node.hooks[i];
                }
            }
        }
        if (node.triggers) {
            for (let i = 0; i < node.triggers.length; i++) {
                let h = WNode.getHookByRef(node.triggers[i].child_node, ref);
                if (h) {
                    return h;
                }
            }
        }
        return null;
    }

    static getNodeByRef(node: WNode, ref: string): WNode {
        if (node.ref === ref) {
            return node;
        }
        if (node.triggers) {
            for (let i = 0; i < node.triggers.length; i++) {
                let n = WNode.getNodeByRef(node.triggers[i].child_node, ref);
                if (n) {
                    return n;
                }
            }
        }
        return null;
    }

    static getNodeByID(node: WNode, id: number): WNode {
        if (node.id === id) {
            return node;
        }
        if (node.triggers) {
            for (let i = 0; i < node.triggers.length; i++) {
                let n = WNode.getNodeByID(node.triggers[i].child_node, id);
                if (n) {
                    return n;
                }
            }
        }
        return null;
    }

    static removeNodeWithChild(parentNode: WNode, node: WNode, nodeID: number, index: number): boolean {
        if (node.id === nodeID) {
            if (parentNode) {
                parentNode.triggers.splice(index, 1);
                return true;
            }
            return false;
        }
        if (node.triggers) {
            for (let i = 0; i < node.triggers.length; i++) {
                let nodeDeleted = WNode.removeNodeWithChild(node, node.triggers[i].child_node, nodeID, i);
                if (nodeDeleted) {
                    return true;
                }
            }
        }
        return false;
    }

    static removeNodeOnly(w: Workflow, parentNode: WNode, node: WNode, nodeID: number, index: number): boolean {
        if (node.id === nodeID) {
            if (index === -1) {
                // deletion of root node
                return false;
            }
            if (parentNode) {
                if (!parentNode.triggers) {
                    parentNode.triggers = new Array<WNodeTrigger>();
                }
                if (node.triggers) {
                    parentNode.triggers.push(...node.triggers);
                }
                parentNode.triggers.splice(index, 1);

                // Check if the node is link to a join
                if (w.workflow_data.joins) {
                    w.workflow_data.joins.forEach(j => {
                        for (let i = 0; i < j.parents.length; i++) {
                            let already = j.parents.findIndex(p => p.parent_id === parentNode.id);
                            if (j.parents[i].parent_id === node.id && already === -1) {
                                j.parents[i].parent_id = parentNode.id;
                                j.parents[i].parent_name = parentNode.ref;
                                break;
                            }
                        }
                    });
                }

            } else {
                // JOin
                w.workflow_data.joins.splice(index, 1);
            }
            return true;
        }
        if (node.triggers) {
            for (let i = 0; i < node.triggers.length; i++) {
                let b = WNode.removeNodeOnly(w, node, node.triggers[i].child_node, nodeID, i);
                if (b) {
                    return true;
                }
            }
        }
        return false;
    }

    static getAllNodes(node: WNode): Array<WNode> {
        let nodes = new Array<WNode>();
        nodes.push(node);
        if (node.triggers) {
            node.triggers.forEach(t => {
                nodes.push(...WNode.getAllNodes(t.child_node));
            });
        }
        return nodes;
    }

    static prepareRequestForAPI(node: WNode) {
        node.id = 0;
        if (node.triggers) {
            node.triggers.forEach(t => {
                WNode.prepareRequestForAPI(t.child_node);
            });
        }
    }

    static getAllHooks(n: WNode): Array<WNodeHook> {
        let res = n.hooks;
        if (n.triggers) {
            n.triggers.forEach(t => {
                let hooks = WNode.getAllHooks(t.child_node);
                if (hooks) {
                    res = res.concat(hooks);
                }

            });
        }
        return res;
    }

    static getAllOutgoingHooks(n: WNode): Array<WNode> {
        let res = new Array<WNode>();
        if (n.type === WNodeType.OUTGOINGHOOK) {
            res.push(n);
        }
        if (n.triggers) {
            n.triggers.forEach(t => {
                res.push(...WNode.getAllOutgoingHooks(t.child_node));
            });
        }
        return res;
    }

    static getNodeNameImpact(node: WNode, name: string, nodeWarn: WorkflowPipelineNameImpact) {
        let varName = 'workflow.' + name;
        if (node.context && node.context.conditions && node.context.conditions.plain) {
            node.context.conditions.plain.forEach(c => {
                if (c.value.indexOf(varName) !== -1 || c.variable.indexOf(varName) !== -1) {
                    nodeWarn.nodes.push(node);
                }
            });
        }
        if (node.triggers) {
            node.triggers.forEach(t => {
                WNode.getNodeNameImpact(t.child_node, name, nodeWarn);
            });
        }
    }

    static linkedToRepo(n: WNode, w: Workflow): boolean {
        if (!n || !n.context || !n.context.application_id) {
            return false;
        }
        let app = w.applications[n.context.application_id];
        return app.repository_fullname != null;
    }
}

export class WNodeTrigger {
    id: number;
    parent_node_id: number;
    child_node_id: number;
    parent_node_name: string;
    child_node: WNode;
}

export class WNodeContext {
    id: number;
    node_id: number;
    pipeline_id: number;
    application_id: number;
    disable_vcs_status: boolean;
    environment_id: number;
    project_integration_id: number;
    default_payload: {};
    default_pipeline_parameters: Array<Parameter>;
    conditions: WorkflowNodeConditions;
    mutex: boolean;

    application_name: string;
    environment_name: string;
    project_integration_name: string;

    constructor() {
        this.pipeline_id = 0;
        this.application_id = 0;
        this.project_integration_id = 0;
        this.environment_id = 0;
    }
}

export class WNodeOutgoingHook {
    id: number;
    node_id: number;
    hook_model_id: number;
    uuid: string;
    config: Map<string, WorkflowNodeHookConfigValue>;

    model: WorkflowHookModel;
}

export class WNodeJoin {
    id: number;
    node_id: number;
    parent_name: string;
    parent_id: number;
}

export class WNodeHook {
    id: number;
    uuid: string;
    ref: string;
    node_id: number;
    hook_model_id: number;
    hook_model_name: string;
    config: Map<string, WorkflowNodeHookConfigValue>;
    conditions: WorkflowNodeConditions;

    // UI only
    model: WorkflowHookModel;
}

export class WorkflowPull {
    workflow: string;
    pipelines: Array<string>;
    applications: Array<string>;
    environments: Array<string>;
}

export const notificationTypes = ['email', 'vcs'];
export const notificationOnSuccess = ['always', 'change', 'never'];
export const notificationOnFailure = ['always', 'change', 'never'];

export class Notification {
    application_pipeline_id: number;
    pipeline: Pipeline;
    environment: Environment;
    notifications: any;

    // UI attribute
    updating = false;

    constructor() {
        this.notifications = {};
    }
}

export class UserNotificationSettings {
    on_success: string;
    on_failure: string;
    on_start: boolean;
    send_to_groups: boolean;
    send_to_author: boolean;
    recipients: Array<string>;
    template: UserNotificationTemplate;
    conditions: WorkflowNodeConditions;

    constructor() {
        this.on_success = notificationOnSuccess[1];
        this.on_failure = notificationOnFailure[0];
        this.on_start = false;
        this.send_to_author = true;
        this.send_to_groups = false;
        this.recipients = [];
        this.template = new UserNotificationTemplate();
        this.conditions = new WorkflowNodeConditions();
    }
}

export class UserNotificationTemplate {
    subject: string;
    body: string;
    disable_comment: boolean;
    disable_status: boolean;
}
