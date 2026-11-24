import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  DeckEngine,
  createSampleDeck,
} from '../core/index';
import type {
  DeckEngineOptions,
  PresentationDeck,
  SlideSelectionPayload,
} from '../core/index';

export type JsonSchemaScalar = string | number | boolean | null;

export type JsonSchemaType =
  | 'object'
  | 'array'
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'null';

export interface JsonSchemaProperty {
  type?: JsonSchemaType;
  oneOf?: JsonSchemaProperty[];
  description?: string;
  title?: string;
  default?: unknown;
  examples?: unknown;
  enum?: JsonSchemaScalar[];
  const?: JsonSchemaScalar;
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface JsonSchemaObject extends JsonSchemaProperty {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface DshToolTextBlock {
  type: 'text';
  text: string;
}

export interface DshToolOutputDefinition<
  TArgs = Record<string, unknown>,
  TResult = unknown,
> {
  schema: JsonSchemaProperty;
  render: (args: TArgs, value: TResult) => DshToolTextBlock[];
  presentationMeta?: (args: TArgs, value: TResult) => unknown;
}

export interface DshToolExecutionContext {
  sessionId?: string;
  fileId?: string;
  selectionRangeId?: string;
  callId?: string;
  rootCallId?: string;
  signal?: AbortSignal;
  agent?: unknown;
  deferContext?: (context: unknown) => void;
  concludeTurn?: () => void;
}

export interface DshToolDefinitionInput<
  TArgs = Record<string, unknown>,
  TResult = unknown,
> {
  name: string;
  description: string;
  inputSchema?: JsonSchemaObject;
  parameters?: JsonSchemaObject;
  output?: DshToolOutputDefinition<TArgs, TResult>;
  deferLoading?: true;
  timeoutMs?: number;
  isConcurrencySafe?: (args: TArgs) => boolean;
  execute: (
    args: TArgs,
    toolCtx?: DshToolExecutionContext
  ) => Promise<TResult> | TResult;
}

export interface DshToolDefinition<
  TArgs = Record<string, unknown>,
  TResult = unknown,
> {
  name: string;
  description: string;
  parameters: JsonSchemaObject;
  inputSchema: JsonSchemaObject;
  output: DshToolOutputDefinition<TArgs, TResult>;
  deferLoading?: true;
  timeoutMs?: number;
  isConcurrencySafe?: (args: TArgs) => boolean;
  execute: (
    args: TArgs,
    toolCtx?: DshToolExecutionContext
  ) => Promise<TResult>;
}

export interface DshToolsService {
  register: (tool: DshToolDefinition<any, any>) => (() => void) | void;
  get?: (name: string) => DshToolDefinition<any, any> | undefined;
  list?: () => DshToolDefinition<any, any>[];
  execute?: (...args: any[]) => Promise<unknown>;
}

export type DshWebRouteKind = 'exact' | 'prefix';

export interface DshWebRoute {
  kind: DshWebRouteKind;
  path: string;
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
}

export interface DshWebServerService {
  readonly host?: string;
  readonly port?: number;
  readonly protocol?: 'http:' | 'https:';
  getOrigin?: () => string;
  register: (route: DshWebRoute) => () => void;
}

export interface DshLogger {
  info?: (message: string, ...args: unknown[]) => void;
  warn?: (message: string, ...args: unknown[]) => void;
  error?: (message: string, ...args: unknown[]) => void;
}

export interface DshServerContext {
  tools: DshToolsService;
  webServer?: DshWebServerService;
  sessions?: any;
  workspaceFiles?: any;
  sessionController?: any;
  sessionQuery?: any;
  logger?: DshLogger;
  on?: (event: string, listener: (...args: any[]) => any) => () => void;
  emit?: (event: string, ...args: any[]) => void;
  effect?: (execute: () => any, label?: string) => any;
  inject?: (deps: any, callback: (ctx: any) => any) => any;
  get?: (name: string, strict?: boolean) => any;
}

export interface PptStudioServerConfig {
  requireDesignMd?: boolean;
  loadSampleDeck?: boolean;
  registry?: DeckRegistry;
}

const SUPPORTED_SCHEMA_TYPES = new Set<JsonSchemaType>([
  'object',
  'array',
  'string',
  'number',
  'integer',
  'boolean',
  'null',
]);

const CONSTRAINT_KEYWORDS = new Set([
  'type',
  'oneOf',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'const',
]);

const ANNOTATION_KEYWORDS = new Set([
  'description',
  'title',
  'default',
  'examples',
]);

const ONE_OF_SIBLING_KEYWORDS = [
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'const',
] as const;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function isLosslessJsonValue(
  value: unknown,
  seen = new Set<unknown>()
): boolean {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) && !Object.is(value, -0);
  }
  if (typeof value !== 'object') {
    return false;
  }
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) {
    const ok = value.every((item) => isLosslessJsonValue(item, seen));
    seen.delete(value);
    return ok;
  }
  if (!isPlainRecord(value)) {
    seen.delete(value);
    return false;
  }
  for (const val of Object.values(value)) {
    if (!isLosslessJsonValue(val, seen)) {
      seen.delete(value);
      return false;
    }
  }
  seen.delete(value);
  return true;
}

function scalarMatchesType(type: JsonSchemaType, value: unknown): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0);
    case 'integer':
      return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        !Object.is(value, -0) &&
        Number.isInteger(value)
      );
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    default:
      return false;
  }
}

export function normalizeJsonSchemaNode(
  rawNode: unknown,
  path = 'schema',
  seen = new Set<object>(),
  isRoot = false
): JsonSchemaProperty {
  if (!isPlainRecord(rawNode)) {
    throw new Error(`${path} must be a plain JSON schema object`);
  }
  if (seen.has(rawNode)) {
    throw new Error(`${path} contains a circular schema reference`);
  }
  seen.add(rawNode);

  try {
    for (const key of Object.keys(rawNode)) {
      if (!CONSTRAINT_KEYWORDS.has(key) && !ANNOTATION_KEYWORDS.has(key)) {
        throw new Error(`${path}.${key} is not a supported JSON schema keyword`);
      }
    }

    const out: JsonSchemaProperty = {};

    if (Object.hasOwn(rawNode, 'description')) {
      if (typeof rawNode.description !== 'string') {
        throw new Error(`${path}.description must be a string`);
      }
      out.description = rawNode.description;
    }
    if (Object.hasOwn(rawNode, 'title')) {
      if (typeof rawNode.title !== 'string') {
        throw new Error(`${path}.title must be a string`);
      }
      out.title = rawNode.title;
    }
    if (Object.hasOwn(rawNode, 'default')) {
      if (!isLosslessJsonValue(rawNode.default)) {
        throw new Error(`${path}.default must be lossless JSON`);
      }
      out.default = rawNode.default;
    }
    if (Object.hasOwn(rawNode, 'examples')) {
      if (!isLosslessJsonValue(rawNode.examples)) {
        throw new Error(`${path}.examples must be lossless JSON`);
      }
      out.examples = rawNode.examples;
    }

    const hasType = Object.hasOwn(rawNode, 'type');
    const hasOneOf = Object.hasOwn(rawNode, 'oneOf');

    if (hasType && hasOneOf) {
      throw new Error(`${path} cannot declare both type and oneOf`);
    }

    if (!hasType && !hasOneOf) {
      for (const kw of ONE_OF_SIBLING_KEYWORDS) {
        if (Object.hasOwn(rawNode, kw)) {
          throw new Error(`${path}.${kw} requires type or oneOf`);
        }
      }
      if (isRoot) {
        throw new Error(`${path}.type must be "object"`);
      }
      return out;
    }

    if (hasOneOf) {
      for (const kw of ONE_OF_SIBLING_KEYWORDS) {
        if (Object.hasOwn(rawNode, kw)) {
          throw new Error(`${path}.${kw} is not supported beside oneOf`);
        }
      }
      if (!Array.isArray(rawNode.oneOf) || rawNode.oneOf.length < 2) {
        throw new Error(`${path}.oneOf must be an array of at least two schemas`);
      }
      if (isRoot) {
        throw new Error(`${path}.type must be "object"`);
      }
      out.oneOf = rawNode.oneOf.map((branch, idx) =>
        normalizeJsonSchemaNode(branch, `${path}.oneOf[${idx}]`, seen, false)
      );
      return out;
    }

    const schemaType = rawNode.type;
    if (
      typeof schemaType !== 'string' ||
      !SUPPORTED_SCHEMA_TYPES.has(schemaType as JsonSchemaType)
    ) {
      throw new Error(`${path}.type has unsupported value ${JSON.stringify(schemaType)}`);
    }
    const typed = schemaType as JsonSchemaType;
    out.type = typed;

    const allowedByType: Record<string, JsonSchemaType[]> = {
      properties: ['object'],
      required: ['object'],
      additionalProperties: ['object'],
      items: ['array'],
      enum: ['string', 'number', 'integer', 'boolean', 'null'],
      const: ['string', 'number', 'integer', 'boolean', 'null'],
    };
    for (const [kw, validTypes] of Object.entries(allowedByType)) {
      if (Object.hasOwn(rawNode, kw) && !validTypes.includes(typed)) {
        throw new Error(`${path}.${kw} is not supported on type "${typed}"`);
      }
    }

    switch (typed) {
      case 'object': {
        const hasProps = Object.hasOwn(rawNode, 'properties');
        const normalizedProps: Record<string, JsonSchemaProperty> = {};
        if (hasProps) {
          if (!isPlainRecord(rawNode.properties)) {
            throw new Error(`${path}.properties must be a plain object`);
          }
          for (const [propKey, propSchema] of Object.entries(rawNode.properties)) {
            normalizedProps[propKey] = normalizeJsonSchemaNode(
              propSchema,
              `${path}.properties.${propKey}`,
              seen,
              false
            );
          }
        }
        out.properties = normalizedProps;

        if (Object.hasOwn(rawNode, 'required')) {
          if (
            !Array.isArray(rawNode.required) ||
            rawNode.required.some((r) => typeof r !== 'string')
          ) {
            throw new Error(`${path}.required must be an array of strings`);
          }
          for (const reqKey of rawNode.required) {
            if (!Object.hasOwn(normalizedProps, reqKey)) {
              throw new Error(
                `${path}.required names "${reqKey}" which is not in properties`
              );
            }
          }
          if (rawNode.required.length > 0) {
            out.required = [...rawNode.required];
          }
        }

        if (Object.hasOwn(rawNode, 'additionalProperties')) {
          if (typeof rawNode.additionalProperties !== 'boolean') {
            throw new Error(`${path}.additionalProperties must be a boolean`);
          }
          out.additionalProperties = rawNode.additionalProperties;
        } else {
          // Structured object with declared properties (or root tool params) closes undeclared keys;
          // free-form object schemas with no declared properties (e.g. ast, selection_payload) remain open.
          out.additionalProperties = hasProps || isRoot ? false : true;
        }
        break;
      }

      case 'array': {
        if (Object.hasOwn(rawNode, 'items')) {
          out.items = normalizeJsonSchemaNode(
            rawNode.items,
            `${path}.items`,
            seen,
            false
          );
        }
        break;
      }

      case 'string':
      case 'number':
      case 'integer':
      case 'boolean':
      case 'null': {
        if (Object.hasOwn(rawNode, 'enum')) {
          if (
            !Array.isArray(rawNode.enum) ||
            rawNode.enum.length === 0 ||
            !rawNode.enum.every((entry) => scalarMatchesType(typed, entry))
          ) {
            throw new Error(`${path}.enum must be a non-empty array of ${typed} values`);
          }
          out.enum = [...rawNode.enum];
        }
        if (Object.hasOwn(rawNode, 'const')) {
          if (!scalarMatchesType(typed, rawNode.const)) {
            throw new Error(`${path}.const must be a ${typed} value`);
          }
          if (out.enum && !out.enum.includes(rawNode.const as JsonSchemaScalar)) {
            throw new Error(`${path}.const must be included in ${path}.enum`);
          }
          out.const = rawNode.const as JsonSchemaScalar;
        }
        break;
      }
    }

    return out;
  } finally {
    seen.delete(rawNode);
  }
}

export function normalizeToolParametersSchema(
  rawSchema: unknown,
  path = 'parameters'
): JsonSchemaObject {
  const normalized = normalizeJsonSchemaNode(
    rawSchema,
    path,
    new Set<object>(),
    true
  );
  if (normalized.type !== 'object' || !normalized.properties) {
    throw new Error(`${path} must be an object schema with properties`);
  }
  return normalized as JsonSchemaObject;
}

export const DEFAULT_TOOL_OUTPUT_SCHEMA: JsonSchemaObject = {
  type: 'object',
  additionalProperties: true,
  properties: {
    ok: { type: 'boolean' },
  },
  required: ['ok'],
};

function stripUndefinedDeep(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== 'object') return value;
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) return value;
  if (seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) =>
      item === undefined ? null : stripUndefinedDeep(item, seen)
    );
  }
  if (!isPlainRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined) continue;
    out[k] = stripUndefinedDeep(v, seen);
  }
  return out;
}

export function defineTool<
  TArgs = Record<string, unknown>,
  TResult = unknown,
>(
  definition: DshToolDefinitionInput<TArgs, TResult>
): DshToolDefinition<TArgs, TResult> {
  const rawSchema = definition.parameters ?? definition.inputSchema;
  if (!rawSchema) {
    throw new Error(
      `defineTool(${definition.name}): parameters or inputSchema is required`
    );
  }
  const normalizedParameters = normalizeToolParametersSchema(
    rawSchema,
    `${definition.name}.parameters`
  );

  const output: DshToolOutputDefinition<TArgs, TResult> = definition.output
    ? {
        schema: normalizeJsonSchemaNode(
          definition.output.schema,
          `${definition.name}.output.schema`
        ),
        render: definition.output.render,
        ...(definition.output.presentationMeta
          ? { presentationMeta: definition.output.presentationMeta }
          : {}),
      }
    : {
        schema: DEFAULT_TOOL_OUTPUT_SCHEMA,
        render: (_args: TArgs, value: TResult) => [
          {
            type: 'text',
            text: typeof value === 'string' ? value : JSON.stringify(value),
          },
        ],
      };

  const userExecute = definition.execute;
  return {
    name: definition.name,
    description: definition.description,
    parameters: normalizedParameters,
    inputSchema: normalizedParameters,
    output,
    ...(definition.deferLoading === true ? { deferLoading: true as const } : {}),
    ...(definition.timeoutMs !== undefined ? { timeoutMs: definition.timeoutMs } : {}),
    ...(definition.isConcurrencySafe
      ? { isConcurrencySafe: definition.isConcurrencySafe }
      : {}),
    execute: (
      args: TArgs,
      toolCtx?: DshToolExecutionContext
    ): Promise<TResult> => {
      const safeArgs = (args ?? {}) as TArgs;
      const result = userExecute(safeArgs, toolCtx);
      if (
        result !== null &&
        (typeof result === 'object' || typeof result === 'function') &&
        typeof (result as PromiseLike<TResult>).then === 'function'
      ) {
        return (result as Promise<TResult>).then(
          (resolved) => stripUndefinedDeep(resolved) as TResult
        );
      }
      return Promise.resolve(stripUndefinedDeep(result) as TResult);
    },
  };
}

export type DeckChangeListener = (
  fileId: string,
  deck: PresentationDeck
) => void;

export class DeckRegistry {
  private engines = new Map<string, DeckEngine>();
  private selections = new Map<string, SlideSelectionPayload>();
  private activeFileId: string | null = null;
  private listeners = new Set<DeckChangeListener>();
  private defaultOptions: DeckEngineOptions;

  constructor(options?: {
    requireDesignMd?: boolean;
    loadSampleDeck?: boolean;
  }) {
    this.defaultOptions = {
      requireDesignMd: options?.requireDesignMd ?? false,
    };
    if (options?.loadSampleDeck === true) {
      const sample = createSampleDeck();
      this.registerDeck(sample, this.defaultOptions);
      this.activeFileId = sample.file_id;
    }
  }

  registerDeck(
    deck: PresentationDeck,
    options?: DeckEngineOptions
  ): DeckEngine {
    const engine = new DeckEngine(deck, {
      ...this.defaultOptions,
      ...options,
    });
    this.engines.set(deck.file_id, engine);
    if (!this.activeFileId) {
      this.activeFileId = deck.file_id;
    }
    this.notifyChange(deck.file_id);
    return engine;
  }

  registerEngine(engine: DeckEngine): DeckEngine {
    const deck = engine.getDeckRef();
    this.engines.set(deck.file_id, engine);
    if (!this.activeFileId) {
      this.activeFileId = deck.file_id;
    }
    this.notifyChange(deck.file_id);
    return engine;
  }

  getEngine(fileId?: string): DeckEngine {
    const targetId = fileId ?? this.activeFileId;
    if (targetId && this.engines.has(targetId)) {
      return this.engines.get(targetId)!;
    }
    const first = this.engines.values().next().value;
    if (first) return first;
    const sample = createSampleDeck();
    return this.registerDeck(sample, this.defaultOptions);
  }

  hasDeck(fileId: string): boolean {
    return this.engines.has(fileId);
  }

  setActiveFileId(fileId: string): void {
    if (this.engines.has(fileId)) {
      this.activeFileId = fileId;
    }
  }

  getActiveFileId(): string | null {
    return this.activeFileId;
  }

  listDecks(): PresentationDeck[] {
    return Array.from(this.engines.values()).map((eng) => eng.getDeck());
  }

  removeDeck(fileId: string): boolean {
    const deleted = this.engines.delete(fileId);
    if (this.activeFileId === fileId) {
      const next = this.engines.keys().next().value ?? null;
      this.activeFileId = next;
    }
    return deleted;
  }

  recordSelection(payload: SlideSelectionPayload): void {
    this.selections.set(payload.rangeId, payload);
    if (this.selections.size > 200) {
      const oldestKey = this.selections.keys().next().value;
      if (oldestKey) this.selections.delete(oldestKey);
    }
  }

  getRecordedSelection(rangeId: string): SlideSelectionPayload | undefined {
    const cleanId = rangeId.startsWith('tdoc-selection://')
      ? decodeURIComponent(rangeId.slice('tdoc-selection://'.length))
      : rangeId;
    return this.selections.get(cleanId);
  }

  onDeckChange(listener: DeckChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  notifyChange(fileId: string): void {
    const engine = this.engines.get(fileId);
    if (!engine) return;
    const snapshot = engine.getDeck();
    for (const listener of this.listeners) {
      listener(fileId, snapshot);
    }
  }
}

export const defaultDeckRegistry = new DeckRegistry({
  loadSampleDeck: false,
});
