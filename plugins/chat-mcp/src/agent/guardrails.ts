import type { ToolCall, ToolSpec } from "../contracts";

/**
 * Client-side argument checks (thesis factor D), run BEFORE a call reaches the MCP server.
 *
 * The MCP server validates too (zod), so with guardrails off a bad call still fails — but
 * later, after a round trip, and with the server's generic message. With guardrails on the
 * loop catches the typical small-model mistakes itself and answers with a message written
 * for the model: unknown tool (with the list of real ones), invalid JSON, missing required
 * fields, wrong types, unknown fields, values outside an enum.
 *
 * Only the JSON Schema subset our tools use is checked (object, required, type, enum,
 * additionalProperties); that keeps the module dependency-free and easy to read.
 */
export function checkToolCall(call: ToolCall, tools: Map<string, ToolSpec>): string | null {
    const spec = tools.get(call.name);
    if (!spec) {
        return `Unknown tool "${call.name}". Available tools: ${[...tools.keys()].join(", ")}.`;
    }
    if (typeof call.arguments === "string") {
        return `The arguments for ${call.name} are not valid JSON: ${truncate(call.arguments, 200)}. Send a JSON object.`;
    }
    const problems = checkObject(call.arguments, spec.inputSchema as JsonSchema, "");
    return problems.length ? `Invalid arguments for ${call.name}: ${problems.join("; ")}.` : null;
}

interface JsonSchema {
    type?: string | string[];
    properties?: Record<string, JsonSchema>;
    required?: string[];
    enum?: unknown[];
    items?: JsonSchema;
    additionalProperties?: boolean | JsonSchema;
    minimum?: number;
    maximum?: number;
    exclusiveMinimum?: number;
}

function checkObject(value: Record<string, unknown>, schema: JsonSchema, path: string): string[] {
    const problems: string[] = [];
    const props = schema.properties || {};
    for (const key of schema.required || []) {
        if (value[key] === undefined) problems.push(`missing required field "${path}${key}"`);
    }
    for (const [key, v] of Object.entries(value)) {
        const sub = props[key];
        if (!sub) {
            if (schema.additionalProperties === false) {
                problems.push(`unknown field "${path}${key}" (allowed: ${Object.keys(props).join(", ") || "none"})`);
            }
            continue;
        }
        problems.push(...checkValue(v, sub, `${path}${key}`));
    }
    return problems;
}

function checkValue(value: unknown, schema: JsonSchema, path: string): string[] {
    if (value === undefined) return [];
    const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
    if (types.length && !types.some((t) => isType(value, t))) {
        return [`"${path}" must be ${types.join(" or ")}, got ${describe(value)}`];
    }
    if (schema.enum && !schema.enum.includes(value)) {
        return [`"${path}" must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(", ")}`];
    }
    if (typeof value === "number") {
        if (schema.minimum !== undefined && value < schema.minimum) return [`"${path}" must be >= ${schema.minimum}`];
        if (schema.maximum !== undefined && value > schema.maximum) return [`"${path}" must be <= ${schema.maximum}`];
        if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) return [`"${path}" must be > ${schema.exclusiveMinimum}`];
    }
    if (Array.isArray(value) && schema.items) {
        return value.flatMap((item, i) => checkValue(item, schema.items!, `${path}[${i}]`));
    }
    if (isType(value, "object") && schema.properties) {
        return checkObject(value as Record<string, unknown>, schema, `${path}.`);
    }
    return [];
}

function isType(value: unknown, type: string): boolean {
    switch (type) {
        case "string": return typeof value === "string";
        case "number": return typeof value === "number" && Number.isFinite(value);
        case "integer": return Number.isInteger(value);
        case "boolean": return typeof value === "boolean";
        case "array": return Array.isArray(value);
        case "object": return !!value && typeof value === "object" && !Array.isArray(value);
        case "null": return value === null;
        default: return true;
    }
}

function describe(value: unknown): string {
    if (Array.isArray(value)) return "array";
    if (value === null) return "null";
    return `${typeof value} ${truncate(JSON.stringify(value), 40)}`;
}

function truncate(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max)}…` : text;
}
