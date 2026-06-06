import { z } from 'zod';
declare const WorkflowNodeDataSchema: z.ZodObject<{
    label: z.ZodString;
    nodeType: z.ZodEnum<["TRIGGER", "CONDITION", "TOOL_CALL", "APPROVAL", "AGENT"]>;
    /** Plain-English instructions describing what this step does and why */
    instructions: z.ZodOptional<z.ZodString>;
    eventType: z.ZodOptional<z.ZodString>;
    eventFilters: z.ZodOptional<z.ZodArray<z.ZodObject<{
        field: z.ZodString;
        operator: z.ZodEnum<["eq", "neq", "gt", "lt", "gte", "lte", "contains", "in"]>;
        value: z.ZodUnion<[z.ZodString, z.ZodNumber, z.ZodArray<z.ZodString, "many">]>;
    }, "strip", z.ZodTypeAny, {
        value: string | number | string[];
        field: string;
        operator: "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "contains" | "in";
    }, {
        value: string | number | string[];
        field: string;
        operator: "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "contains" | "in";
    }>, "many">>;
    roleFilters: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    teamFilters: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    conditionField: z.ZodOptional<z.ZodString>;
    conditionSource: z.ZodOptional<z.ZodEnum<["context", "payload", "variable"]>>;
    conditionOperator: z.ZodOptional<z.ZodEnum<["eq", "neq", "gt", "lt", "gte", "lte", "contains", "in", "starts_with", "ends_with", "is_empty", "is_not_empty", "regex_match", "between"]>>;
    conditionValue: z.ZodOptional<z.ZodString>;
    toolName: z.ZodOptional<z.ZodString>;
    toolParams: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    toolOutputKey: z.ZodOptional<z.ZodString>;
    toolDomain: z.ZodOptional<z.ZodEnum<["billing", "operations", "growth", "team"]>>;
    approverIds: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    approvalMode: z.ZodOptional<z.ZodEnum<["any", "all"]>>;
    approvalTimeoutDays: z.ZodOptional<z.ZodNumber>;
    agentToolDomains: z.ZodOptional<z.ZodArray<z.ZodEnum<["billing", "operations", "growth", "team"]>, "many">>;
    agentOutputKey: z.ZodOptional<z.ZodString>;
    agentMaxTurns: z.ZodOptional<z.ZodNumber>;
    outputVariables: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        key: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        name: string;
        key: string;
    }, {
        name: string;
        key: string;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    label: string;
    nodeType: "TRIGGER" | "CONDITION" | "TOOL_CALL" | "APPROVAL" | "AGENT";
    instructions?: string | undefined;
    eventType?: string | undefined;
    eventFilters?: {
        value: string | number | string[];
        field: string;
        operator: "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "contains" | "in";
    }[] | undefined;
    roleFilters?: string[] | undefined;
    teamFilters?: string[] | undefined;
    conditionField?: string | undefined;
    conditionSource?: "context" | "payload" | "variable" | undefined;
    conditionOperator?: "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "contains" | "in" | "starts_with" | "ends_with" | "is_empty" | "is_not_empty" | "regex_match" | "between" | undefined;
    conditionValue?: string | undefined;
    toolName?: string | undefined;
    toolParams?: Record<string, unknown> | undefined;
    toolOutputKey?: string | undefined;
    toolDomain?: "billing" | "operations" | "growth" | "team" | undefined;
    approverIds?: string[] | undefined;
    approvalMode?: "any" | "all" | undefined;
    approvalTimeoutDays?: number | undefined;
    agentToolDomains?: ("billing" | "operations" | "growth" | "team")[] | undefined;
    agentOutputKey?: string | undefined;
    agentMaxTurns?: number | undefined;
    outputVariables?: {
        name: string;
        key: string;
    }[] | undefined;
}, {
    label: string;
    nodeType: "TRIGGER" | "CONDITION" | "TOOL_CALL" | "APPROVAL" | "AGENT";
    instructions?: string | undefined;
    eventType?: string | undefined;
    eventFilters?: {
        value: string | number | string[];
        field: string;
        operator: "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "contains" | "in";
    }[] | undefined;
    roleFilters?: string[] | undefined;
    teamFilters?: string[] | undefined;
    conditionField?: string | undefined;
    conditionSource?: "context" | "payload" | "variable" | undefined;
    conditionOperator?: "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "contains" | "in" | "starts_with" | "ends_with" | "is_empty" | "is_not_empty" | "regex_match" | "between" | undefined;
    conditionValue?: string | undefined;
    toolName?: string | undefined;
    toolParams?: Record<string, unknown> | undefined;
    toolOutputKey?: string | undefined;
    toolDomain?: "billing" | "operations" | "growth" | "team" | undefined;
    approverIds?: string[] | undefined;
    approvalMode?: "any" | "all" | undefined;
    approvalTimeoutDays?: number | undefined;
    agentToolDomains?: ("billing" | "operations" | "growth" | "team")[] | undefined;
    agentOutputKey?: string | undefined;
    agentMaxTurns?: number | undefined;
    outputVariables?: {
        name: string;
        key: string;
    }[] | undefined;
}>;
declare const WorkflowNodeSchema: z.ZodObject<{
    id: z.ZodString;
    type: z.ZodString;
    position: z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        x: number;
        y: number;
    }, {
        x: number;
        y: number;
    }>;
    data: z.ZodObject<{
        label: z.ZodString;
        nodeType: z.ZodEnum<["TRIGGER", "CONDITION", "TOOL_CALL", "APPROVAL", "AGENT"]>;
        /** Plain-English instructions describing what this step does and why */
        instructions: z.ZodOptional<z.ZodString>;
        eventType: z.ZodOptional<z.ZodString>;
        eventFilters: z.ZodOptional<z.ZodArray<z.ZodObject<{
            field: z.ZodString;
            operator: z.ZodEnum<["eq", "neq", "gt", "lt", "gte", "lte", "contains", "in"]>;
            value: z.ZodUnion<[z.ZodString, z.ZodNumber, z.ZodArray<z.ZodString, "many">]>;
        }, "strip", z.ZodTypeAny, {
            value: string | number | string[];
            field: string;
            operator: "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "contains" | "in";
        }, {
            value: string | number | string[];
            field: string;
            operator: "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "contains" | "in";
        }>, "many">>;
        roleFilters: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        teamFilters: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        conditionField: z.ZodOptional<z.ZodString>;
        conditionSource: z.ZodOptional<z.ZodEnum<["context", "payload", "variable"]>>;
        conditionOperator: z.ZodOptional<z.ZodEnum<["eq", "neq", "gt", "lt", "gte", "lte", "contains", "in", "starts_with", "ends_with", "is_empty", "is_not_empty", "regex_match", "between"]>>;
        conditionValue: z.ZodOptional<z.ZodString>;
        toolName: z.ZodOptional<z.ZodString>;
        toolParams: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        toolOutputKey: z.ZodOptional<z.ZodString>;
        toolDomain: z.ZodOptional<z.ZodEnum<["billing", "operations", "growth", "team"]>>;
        approverIds: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        approvalMode: z.ZodOptional<z.ZodEnum<["any", "all"]>>;
        approvalTimeoutDays: z.ZodOptional<z.ZodNumber>;
        agentToolDomains: z.ZodOptional<z.ZodArray<z.ZodEnum<["billing", "operations", "growth", "team"]>, "many">>;
        agentOutputKey: z.ZodOptional<z.ZodString>;
        agentMaxTurns: z.ZodOptional<z.ZodNumber>;
        outputVariables: z.ZodOptional<z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            key: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            name: string;
            key: string;
        }, {
            name: string;
            key: string;
        }>, "many">>;
    }, "strip", z.ZodTypeAny, {
        label: string;
        nodeType: "TRIGGER" | "CONDITION" | "TOOL_CALL" | "APPROVAL" | "AGENT";
        instructions?: string | undefined;
        eventType?: string | undefined;
        eventFilters?: {
            value: string | number | string[];
            field: string;
            operator: "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "contains" | "in";
        }[] | undefined;
        roleFilters?: string[] | undefined;
        teamFilters?: string[] | undefined;
        conditionField?: string | undefined;
        conditionSource?: "context" | "payload" | "variable" | undefined;
        conditionOperator?: "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "contains" | "in" | "starts_with" | "ends_with" | "is_empty" | "is_not_empty" | "regex_match" | "between" | undefined;
        conditionValue?: string | undefined;
        toolName?: string | undefined;
        toolParams?: Record<string, unknown> | undefined;
        toolOutputKey?: string | undefined;
        toolDomain?: "billing" | "operations" | "growth" | "team" | undefined;
        approverIds?: string[] | undefined;
        approvalMode?: "any" | "all" | undefined;
        approvalTimeoutDays?: number | undefined;
        agentToolDomains?: ("billing" | "operations" | "growth" | "team")[] | undefined;
        agentOutputKey?: string | undefined;
        agentMaxTurns?: number | undefined;
        outputVariables?: {
            name: string;
            key: string;
        }[] | undefined;
    }, {
        label: string;
        nodeType: "TRIGGER" | "CONDITION" | "TOOL_CALL" | "APPROVAL" | "AGENT";
        instructions?: string | undefined;
        eventType?: string | undefined;
        eventFilters?: {
            value: string | number | string[];
            field: string;
            operator: "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "contains" | "in";
        }[] | undefined;
        roleFilters?: string[] | undefined;
        teamFilters?: string[] | undefined;
        conditionField?: string | undefined;
        conditionSource?: "context" | "payload" | "variable" | undefined;
        conditionOperator?: "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "contains" | "in" | "starts_with" | "ends_with" | "is_empty" | "is_not_empty" | "regex_match" | "between" | undefined;
        conditionValue?: string | undefined;
        toolName?: string | undefined;
        toolParams?: Record<string, unknown> | undefined;
        toolOutputKey?: string | undefined;
        toolDomain?: "billing" | "operations" | "growth" | "team" | undefined;
        approverIds?: string[] | undefined;
        approvalMode?: "any" | "all" | undefined;
        approvalTimeoutDays?: number | undefined;
        agentToolDomains?: ("billing" | "operations" | "growth" | "team")[] | undefined;
        agentOutputKey?: string | undefined;
        agentMaxTurns?: number | undefined;
        outputVariables?: {
            name: string;
            key: string;
        }[] | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    type: string;
    id: string;
    position: {
        x: number;
        y: number;
    };
    data: {
        label: string;
        nodeType: "TRIGGER" | "CONDITION" | "TOOL_CALL" | "APPROVAL" | "AGENT";
        instructions?: string | undefined;
        eventType?: string | undefined;
        eventFilters?: {
            value: string | number | string[];
            field: string;
            operator: "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "contains" | "in";
        }[] | undefined;
        roleFilters?: string[] | undefined;
        teamFilters?: string[] | undefined;
        conditionField?: string | undefined;
        conditionSource?: "context" | "payload" | "variable" | undefined;
        conditionOperator?: "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "contains" | "in" | "starts_with" | "ends_with" | "is_empty" | "is_not_empty" | "regex_match" | "between" | undefined;
        conditionValue?: string | undefined;
        toolName?: string | undefined;
        toolParams?: Record<string, unknown> | undefined;
        toolOutputKey?: string | undefined;
        toolDomain?: "billing" | "operations" | "growth" | "team" | undefined;
        approverIds?: string[] | undefined;
        approvalMode?: "any" | "all" | undefined;
        approvalTimeoutDays?: number | undefined;
        agentToolDomains?: ("billing" | "operations" | "growth" | "team")[] | undefined;
        agentOutputKey?: string | undefined;
        agentMaxTurns?: number | undefined;
        outputVariables?: {
            name: string;
            key: string;
        }[] | undefined;
    };
}, {
    type: string;
    id: string;
    position: {
        x: number;
        y: number;
    };
    data: {
        label: string;
        nodeType: "TRIGGER" | "CONDITION" | "TOOL_CALL" | "APPROVAL" | "AGENT";
        instructions?: string | undefined;
        eventType?: string | undefined;
        eventFilters?: {
            value: string | number | string[];
            field: string;
            operator: "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "contains" | "in";
        }[] | undefined;
        roleFilters?: string[] | undefined;
        teamFilters?: string[] | undefined;
        conditionField?: string | undefined;
        conditionSource?: "context" | "payload" | "variable" | undefined;
        conditionOperator?: "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "contains" | "in" | "starts_with" | "ends_with" | "is_empty" | "is_not_empty" | "regex_match" | "between" | undefined;
        conditionValue?: string | undefined;
        toolName?: string | undefined;
        toolParams?: Record<string, unknown> | undefined;
        toolOutputKey?: string | undefined;
        toolDomain?: "billing" | "operations" | "growth" | "team" | undefined;
        approverIds?: string[] | undefined;
        approvalMode?: "any" | "all" | undefined;
        approvalTimeoutDays?: number | undefined;
        agentToolDomains?: ("billing" | "operations" | "growth" | "team")[] | undefined;
        agentOutputKey?: string | undefined;
        agentMaxTurns?: number | undefined;
        outputVariables?: {
            name: string;
            key: string;
        }[] | undefined;
    };
}>;
declare const WorkflowEdgeSchema: z.ZodObject<{
    id: z.ZodString;
    source: z.ZodString;
    target: z.ZodString;
    sourceHandle: z.ZodOptional<z.ZodString>;
    targetHandle: z.ZodOptional<z.ZodString>;
    label: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    id: string;
    source: string;
    target: string;
    label?: string | undefined;
    sourceHandle?: string | undefined;
    targetHandle?: string | undefined;
}, {
    id: string;
    source: string;
    target: string;
    label?: string | undefined;
    sourceHandle?: string | undefined;
    targetHandle?: string | undefined;
}>;
export declare const OnboardingWorkflowStoredSchema: z.ZodObject<{
    orgId: z.ZodString;
    sk: z.ZodString;
    workflowId: z.ZodString;
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    isActive: z.ZodDefault<z.ZodBoolean>;
    nodes: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        type: z.ZodString;
        position: z.ZodObject<{
            x: z.ZodNumber;
            y: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            x: number;
            y: number;
        }, {
            x: number;
            y: number;
        }>;
        data: z.ZodObject<{
            label: z.ZodString;
            nodeType: z.ZodEnum<["TRIGGER", "CONDITION", "TOOL_CALL", "APPROVAL", "AGENT"]>;
            /** Plain-English instructions describing what this step does and why */
            instructions: z.ZodOptional<z.ZodString>;
            eventType: z.ZodOptional<z.ZodString>;
            eventFilters: z.ZodOptional<z.ZodArray<z.ZodObject<{
                field: z.ZodString;
                operator: z.ZodEnum<["eq", "neq", "gt", "lt", "gte", "lte", "contains", "in"]>;
                value: z.ZodUnion<[z.ZodString, z.ZodNumber, z.ZodArray<z.ZodString, "many">]>;
            }, "strip", z.ZodTypeAny, {
                value: string | number | string[];
                field: string;
                operator: "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "contains" | "in";
            }, {
                value: string | number | string[];
                field: string;
                operator: "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "contains" | "in";
            }>, "many">>;
            roleFilters: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            teamFilters: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            conditionField: z.ZodOptional<z.ZodString>;
            conditionSource: z.ZodOptional<z.ZodEnum<["context", "payload", "variable"]>>;
            conditionOperator: z.ZodOptional<z.ZodEnum<["eq", "neq", "gt", "lt", "gte", "lte", "contains", "in", "starts_with", "ends_with", "is_empty", "is_not_empty", "regex_match", "between"]>>;
            conditionValue: z.ZodOptional<z.ZodString>;
            toolName: z.ZodOptional<z.ZodString>;
            toolParams: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            toolOutputKey: z.ZodOptional<z.ZodString>;
            toolDomain: z.ZodOptional<z.ZodEnum<["billing", "operations", "growth", "team"]>>;
            approverIds: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            approvalMode: z.ZodOptional<z.ZodEnum<["any", "all"]>>;
            approvalTimeoutDays: z.ZodOptional<z.ZodNumber>;
            agentToolDomains: z.ZodOptional<z.ZodArray<z.ZodEnum<["billing", "operations", "growth", "team"]>, "many">>;
            agentOutputKey: z.ZodOptional<z.ZodString>;
            agentMaxTurns: z.ZodOptional<z.ZodNumber>;
            outputVariables: z.ZodOptional<z.ZodArray<z.ZodObject<{
                name: z.ZodString;
                key: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                name: string;
                key: string;
            }, {
                name: string;
                key: string;
            }>, "many">>;
        }, "strip", z.ZodTypeAny, {
            label: string;
            nodeType: "TRIGGER" | "CONDITION" | "TOOL_CALL" | "APPROVAL" | "AGENT";
            instructions?: string | undefined;
            eventType?: string | undefined;
            eventFilters?: {
                value: string | number | string[];
                field: string;
                operator: "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "contains" | "in";
            }[] | undefined;
            roleFilters?: string[] | undefined;
            teamFilters?: string[] | undefined;
            conditionField?: string | undefined;
            conditionSource?: "context" | "payload" | "variable" | undefined;
            conditionOperator?: "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "contains" | "in" | "starts_with" | "ends_with" | "is_empty" | "is_not_empty" | "regex_match" | "between" | undefined;
            conditionValue?: string | undefined;
            toolName?: string | undefined;
            toolParams?: Record<string, unknown> | undefined;
            toolOutputKey?: string | undefined;
            toolDomain?: "billing" | "operations" | "growth" | "team" | undefined;
            approverIds?: string[] | undefined;
            approvalMode?: "any" | "all" | undefined;
            approvalTimeoutDays?: number | undefined;
            agentToolDomains?: ("billing" | "operations" | "growth" | "team")[] | undefined;
            agentOutputKey?: string | undefined;
            agentMaxTurns?: number | undefined;
            outputVariables?: {
                name: string;
                key: string;
            }[] | undefined;
        }, {
            label: string;
            nodeType: "TRIGGER" | "CONDITION" | "TOOL_CALL" | "APPROVAL" | "AGENT";
            instructions?: string | undefined;
            eventType?: string | undefined;
            eventFilters?: {
                value: string | number | string[];
                field: string;
                operator: "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "contains" | "in";
            }[] | undefined;
            roleFilters?: string[] | undefined;
            teamFilters?: string[] | undefined;
            conditionField?: string | undefined;
            conditionSource?: "context" | "payload" | "variable" | undefined;
            conditionOperator?: "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "contains" | "in" | "starts_with" | "ends_with" | "is_empty" | "is_not_empty" | "regex_match" | "between" | undefined;
            conditionValue?: string | undefined;
            toolName?: string | undefined;
            toolParams?: Record<string, unknown> | undefined;
            toolOutputKey?: string | undefined;
            toolDomain?: "billing" | "operations" | "growth" | "team" | undefined;
            approverIds?: string[] | undefined;
            approvalMode?: "any" | "all" | undefined;
            approvalTimeoutDays?: number | undefined;
            agentToolDomains?: ("billing" | "operations" | "growth" | "team")[] | undefined;
            agentOutputKey?: string | undefined;
            agentMaxTurns?: number | undefined;
            outputVariables?: {
                name: string;
                key: string;
            }[] | undefined;
        }>;
    }, "strip", z.ZodTypeAny, {
        type: string;
        id: string;
        position: {
            x: number;
            y: number;
        };
        data: {
            label: string;
            nodeType: "TRIGGER" | "CONDITION" | "TOOL_CALL" | "APPROVAL" | "AGENT";
            instructions?: string | undefined;
            eventType?: string | undefined;
            eventFilters?: {
                value: string | number | string[];
                field: string;
                operator: "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "contains" | "in";
            }[] | undefined;
            roleFilters?: string[] | undefined;
            teamFilters?: string[] | undefined;
            conditionField?: string | undefined;
            conditionSource?: "context" | "payload" | "variable" | undefined;
            conditionOperator?: "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "contains" | "in" | "starts_with" | "ends_with" | "is_empty" | "is_not_empty" | "regex_match" | "between" | undefined;
            conditionValue?: string | undefined;
            toolName?: string | undefined;
            toolParams?: Record<string, unknown> | undefined;
            toolOutputKey?: string | undefined;
            toolDomain?: "billing" | "operations" | "growth" | "team" | undefined;
            approverIds?: string[] | undefined;
            approvalMode?: "any" | "all" | undefined;
            approvalTimeoutDays?: number | undefined;
            agentToolDomains?: ("billing" | "operations" | "growth" | "team")[] | undefined;
            agentOutputKey?: string | undefined;
            agentMaxTurns?: number | undefined;
            outputVariables?: {
                name: string;
                key: string;
            }[] | undefined;
        };
    }, {
        type: string;
        id: string;
        position: {
            x: number;
            y: number;
        };
        data: {
            label: string;
            nodeType: "TRIGGER" | "CONDITION" | "TOOL_CALL" | "APPROVAL" | "AGENT";
            instructions?: string | undefined;
            eventType?: string | undefined;
            eventFilters?: {
                value: string | number | string[];
                field: string;
                operator: "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "contains" | "in";
            }[] | undefined;
            roleFilters?: string[] | undefined;
            teamFilters?: string[] | undefined;
            conditionField?: string | undefined;
            conditionSource?: "context" | "payload" | "variable" | undefined;
            conditionOperator?: "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "contains" | "in" | "starts_with" | "ends_with" | "is_empty" | "is_not_empty" | "regex_match" | "between" | undefined;
            conditionValue?: string | undefined;
            toolName?: string | undefined;
            toolParams?: Record<string, unknown> | undefined;
            toolOutputKey?: string | undefined;
            toolDomain?: "billing" | "operations" | "growth" | "team" | undefined;
            approverIds?: string[] | undefined;
            approvalMode?: "any" | "all" | undefined;
            approvalTimeoutDays?: number | undefined;
            agentToolDomains?: ("billing" | "operations" | "growth" | "team")[] | undefined;
            agentOutputKey?: string | undefined;
            agentMaxTurns?: number | undefined;
            outputVariables?: {
                name: string;
                key: string;
            }[] | undefined;
        };
    }>, "many">;
    edges: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        source: z.ZodString;
        target: z.ZodString;
        sourceHandle: z.ZodOptional<z.ZodString>;
        targetHandle: z.ZodOptional<z.ZodString>;
        label: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        source: string;
        target: string;
        label?: string | undefined;
        sourceHandle?: string | undefined;
        targetHandle?: string | undefined;
    }, {
        id: string;
        source: string;
        target: string;
        label?: string | undefined;
        sourceHandle?: string | undefined;
        targetHandle?: string | undefined;
    }>, "many">;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
    createdBy: z.ZodOptional<z.ZodString>;
    updatedBy: z.ZodOptional<z.ZodString>;
    currentVersion: z.ZodOptional<z.ZodNumber>;
    activeVersion: z.ZodOptional<z.ZodNumber>;
    executorType: z.ZodOptional<z.ZodEnum<["v1_durable", "v2_agent"]>>;
}, "strip", z.ZodTypeAny, {
    name: string;
    createdAt: string;
    updatedAt: string;
    orgId: string;
    sk: string;
    workflowId: string;
    isActive: boolean;
    nodes: {
        type: string;
        id: string;
        position: {
            x: number;
            y: number;
        };
        data: {
            label: string;
            nodeType: "TRIGGER" | "CONDITION" | "TOOL_CALL" | "APPROVAL" | "AGENT";
            instructions?: string | undefined;
            eventType?: string | undefined;
            eventFilters?: {
                value: string | number | string[];
                field: string;
                operator: "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "contains" | "in";
            }[] | undefined;
            roleFilters?: string[] | undefined;
            teamFilters?: string[] | undefined;
            conditionField?: string | undefined;
            conditionSource?: "context" | "payload" | "variable" | undefined;
            conditionOperator?: "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "contains" | "in" | "starts_with" | "ends_with" | "is_empty" | "is_not_empty" | "regex_match" | "between" | undefined;
            conditionValue?: string | undefined;
            toolName?: string | undefined;
            toolParams?: Record<string, unknown> | undefined;
            toolOutputKey?: string | undefined;
            toolDomain?: "billing" | "operations" | "growth" | "team" | undefined;
            approverIds?: string[] | undefined;
            approvalMode?: "any" | "all" | undefined;
            approvalTimeoutDays?: number | undefined;
            agentToolDomains?: ("billing" | "operations" | "growth" | "team")[] | undefined;
            agentOutputKey?: string | undefined;
            agentMaxTurns?: number | undefined;
            outputVariables?: {
                name: string;
                key: string;
            }[] | undefined;
        };
    }[];
    edges: {
        id: string;
        source: string;
        target: string;
        label?: string | undefined;
        sourceHandle?: string | undefined;
        targetHandle?: string | undefined;
    }[];
    createdBy?: string | undefined;
    description?: string | undefined;
    updatedBy?: string | undefined;
    currentVersion?: number | undefined;
    activeVersion?: number | undefined;
    executorType?: "v1_durable" | "v2_agent" | undefined;
}, {
    name: string;
    createdAt: string;
    updatedAt: string;
    orgId: string;
    sk: string;
    workflowId: string;
    nodes: {
        type: string;
        id: string;
        position: {
            x: number;
            y: number;
        };
        data: {
            label: string;
            nodeType: "TRIGGER" | "CONDITION" | "TOOL_CALL" | "APPROVAL" | "AGENT";
            instructions?: string | undefined;
            eventType?: string | undefined;
            eventFilters?: {
                value: string | number | string[];
                field: string;
                operator: "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "contains" | "in";
            }[] | undefined;
            roleFilters?: string[] | undefined;
            teamFilters?: string[] | undefined;
            conditionField?: string | undefined;
            conditionSource?: "context" | "payload" | "variable" | undefined;
            conditionOperator?: "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "contains" | "in" | "starts_with" | "ends_with" | "is_empty" | "is_not_empty" | "regex_match" | "between" | undefined;
            conditionValue?: string | undefined;
            toolName?: string | undefined;
            toolParams?: Record<string, unknown> | undefined;
            toolOutputKey?: string | undefined;
            toolDomain?: "billing" | "operations" | "growth" | "team" | undefined;
            approverIds?: string[] | undefined;
            approvalMode?: "any" | "all" | undefined;
            approvalTimeoutDays?: number | undefined;
            agentToolDomains?: ("billing" | "operations" | "growth" | "team")[] | undefined;
            agentOutputKey?: string | undefined;
            agentMaxTurns?: number | undefined;
            outputVariables?: {
                name: string;
                key: string;
            }[] | undefined;
        };
    }[];
    edges: {
        id: string;
        source: string;
        target: string;
        label?: string | undefined;
        sourceHandle?: string | undefined;
        targetHandle?: string | undefined;
    }[];
    createdBy?: string | undefined;
    description?: string | undefined;
    updatedBy?: string | undefined;
    isActive?: boolean | undefined;
    currentVersion?: number | undefined;
    activeVersion?: number | undefined;
    executorType?: "v1_durable" | "v2_agent" | undefined;
}>;
export type OnboardingWorkflow = z.infer<typeof OnboardingWorkflowStoredSchema>;
export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;
export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>;
export type WorkflowNodeData = z.infer<typeof WorkflowNodeDataSchema>;
export {};
//# sourceMappingURL=schema.d.ts.map