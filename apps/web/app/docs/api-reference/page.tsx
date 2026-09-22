import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Code, DocHeader, DocTable, H2, Method, Note, Tok } from "@/components/docs/parts";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "API reference",
  description: "Every NATIO endpoint rendered from the published OpenAPI 3.1 document: servers, authentication, parameters, request bodies, response codes and the component schemas.",
};

const API_INTERNAL_URL = process.env.API_INTERNAL_URL || "http://localhost:4000";

// ---------------------------------------------------------------------------
// Minimal OpenAPI 3.1 model — only what this page renders.
// ---------------------------------------------------------------------------
interface JsonSchema {
  $ref?: string;
  type?: string | string[];
  format?: string;
  description?: string;
  title?: string;
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  example?: unknown;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  allOf?: JsonSchema[];
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  additionalProperties?: JsonSchema | boolean;
}

interface MediaType {
  schema?: JsonSchema;
  example?: unknown;
  examples?: Record<string, { value?: unknown; summary?: string }>;
}

interface Parameter {
  $ref?: string;
  name?: string;
  in?: string;
  required?: boolean;
  description?: string;
  schema?: JsonSchema;
}

interface RequestBody {
  $ref?: string;
  required?: boolean;
  description?: string;
  content?: Record<string, MediaType>;
}

interface ResponseObject {
  $ref?: string;
  description?: string;
  content?: Record<string, MediaType>;
}

interface Operation {
  tags?: string[];
  summary?: string;
  description?: string;
  operationId?: string;
  deprecated?: boolean;
  parameters?: Parameter[];
  requestBody?: RequestBody;
  responses?: Record<string, ResponseObject>;
  security?: Array<Record<string, string[]>>;
}

interface SecurityScheme {
  type?: string;
  scheme?: string;
  name?: string;
  in?: string;
  bearerFormat?: string;
  description?: string;
}

interface Spec {
  openapi?: string;
  info?: { title?: string; version?: string; description?: string; contact?: { name?: string; url?: string; email?: string } };
  servers?: Array<{ url?: string; description?: string }>;
  security?: Array<Record<string, string[]>>;
  tags?: Array<{ name?: string; description?: string }>;
  paths?: Record<string, Record<string, unknown>>;
  components?: {
    securitySchemes?: Record<string, SecurityScheme>;
    parameters?: Record<string, Parameter>;
    responses?: Record<string, ResponseObject>;
    schemas?: Record<string, JsonSchema>;
  };
}

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options", "trace"] as const;

// ---------------------------------------------------------------------------
// $ref resolution
// ---------------------------------------------------------------------------
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Walk a local JSON pointer such as `#/components/schemas/Payment`. */
function lookup(spec: Spec, ref: string): unknown {
  if (!ref.startsWith("#/")) return undefined;
  const segments = ref
    .slice(2)
    .split("/")
    .map((s) => decodeURIComponent(s).replace(/~1/g, "/").replace(/~0/g, "~"));
  let node: unknown = spec;
  for (const segment of segments) {
    if (!isRecord(node)) return undefined;
    node = node[segment];
  }
  return node;
}

/** Follow `$ref` chains (bounded) and return the resolved node. */
function resolve<T extends { $ref?: string }>(spec: Spec, node: T | undefined): T | undefined {
  let current: unknown = node;
  for (let hops = 0; hops < 8; hops++) {
    if (!isRecord(current)) return undefined;
    const ref = current["$ref"];
    if (typeof ref !== "string") break;
    current = lookup(spec, ref);
  }
  return isRecord(current) ? (current as T) : undefined;
}

/** The trailing name of a `$ref`, used both as a label and as an anchor. */
function refName(ref: string | undefined): string | undefined {
  if (!ref) return undefined;
  const parts = ref.split("/");
  return parts[parts.length - 1] || undefined;
}

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------
function typeLabel(spec: Spec, schema: JsonSchema | undefined): string {
  if (!schema) return "—";
  if (schema.$ref) return refName(schema.$ref) ?? "object";
  if (schema.const !== undefined) return `const ${JSON.stringify(schema.const)}`;

  const composite = schema.oneOf ?? schema.anyOf ?? schema.allOf;
  if (composite && composite.length) return composite.map((s) => typeLabel(spec, s)).join(schema.allOf ? " + " : " | ");

  const base = Array.isArray(schema.type) ? schema.type.join(" | ") : (schema.type ?? (schema.properties ? "object" : schema.enum ? "string" : "any"));
  if (base.includes("array") && schema.items) return `array of ${typeLabel(spec, schema.items)}`;
  if (schema.format) return `${base} <${schema.format}>`;
  return base;
}

function constraintNote(schema: JsonSchema | undefined): string | undefined {
  if (!schema) return undefined;
  const bits: string[] = [];
  if (schema.default !== undefined) bits.push(`default ${JSON.stringify(schema.default)}`);
  if (schema.minimum !== undefined) bits.push(`min ${schema.minimum}`);
  if (schema.maximum !== undefined) bits.push(`max ${schema.maximum}`);
  if (schema.maxLength !== undefined) bits.push(`max length ${schema.maxLength}`);
  return bits.length ? bits.join(" · ") : undefined;
}

function enumNote(schema: JsonSchema | undefined): string | undefined {
  const values = schema?.enum;
  if (!values || !values.length) return undefined;
  return values.map((v) => (v === null ? "null" : String(v))).join(" · ");
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function opAnchor(method: string, path: string): string {
  return `op-${method}-${slug(path)}`;
}

function schemaAnchor(name: string): string {
  return `schema-${slug(name)}`;
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/** Spec descriptions use Markdown backticks for code. Render those as <code>, leave the rest as text. */
function SpecText({ text }: { text: string | undefined }): ReactNode {
  if (!text) return null;
  const parts = text.split("`");
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <code key={i} className="font-mono text-[12px]">
            {part}
          </code>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Property tables
// ---------------------------------------------------------------------------
interface PropRow {
  name: string;
  depth: number;
  schema: JsonSchema;
  required: boolean;
}

/** Flatten an object schema into rows, descending into nested objects up to `maxDepth`. */
function propertyRows(spec: Spec, schema: JsonSchema | undefined, depth = 0, maxDepth = 1): PropRow[] {
  const resolved = schema?.$ref ? resolve<JsonSchema>(spec, schema) : schema;
  if (!resolved) return [];

  let source = resolved;
  if (!source.properties && source.allOf?.length) {
    const merged: JsonSchema = { type: "object", properties: {}, required: [] };
    for (const part of source.allOf) {
      const sub = resolve<JsonSchema>(spec, part) ?? part;
      Object.assign(merged.properties as Record<string, JsonSchema>, sub.properties ?? {});
      if (sub.required) (merged.required as string[]).push(...sub.required);
    }
    source = merged;
  }
  if (!source.properties) return [];

  const required = new Set(source.required ?? []);
  const rows: PropRow[] = [];
  for (const [name, raw] of Object.entries(source.properties)) {
    rows.push({ name, depth, schema: raw, required: required.has(name) });
    if (depth < maxDepth) {
      const child = raw.$ref ? undefined : raw.type === "object" || (Array.isArray(raw.type) && raw.type.includes("object")) ? raw : raw.items?.properties ? raw.items : undefined;
      if (child?.properties) rows.push(...propertyRows(spec, child, depth + 1, maxDepth));
    }
  }
  return rows;
}

function PropertyTable({ spec, schema }: { spec: Spec; schema: JsonSchema | undefined }) {
  const rows = propertyRows(spec, schema);
  if (!rows.length) return null;
  return (
    <DocTable
      dense
      columns={["Field", "Type", "Notes"]}
      rows={rows.map((row) => {
        const enums = enumNote(row.schema);
        const constraints = constraintNote(row.schema);
        return [
          <span key={`${row.name}-${row.depth}`} style={{ paddingLeft: row.depth * 14 }} className="inline-block">
            {row.depth > 0 ? <span className="mr-1 font-mono text-mist-600">└</span> : null}
            <code className="font-mono text-[12px]">{row.name}</code>
            {row.required ? <span className="ml-1.5 text-[10px] font-medium uppercase tracking-wide text-rose-300">required</span> : null}
          </span>,
          <span key={`${row.name}-t`} className="whitespace-nowrap font-mono text-[11.5px] text-mist-400">
            {typeLabel(spec, row.schema)}
          </span>,
          <span key={`${row.name}-d`}>
            {row.schema.description ? (
              <span className="block">
                <SpecText text={row.schema.description} />
              </span>
            ) : null}
            {enums ? <span className="mt-0.5 block font-mono text-[11px] text-mist-400">{enums}</span> : null}
            {constraints ? <span className="mt-0.5 block font-mono text-[11px] text-mist-400">{constraints}</span> : null}
          </span>,
        ];
      })}
    />
  );
}

// ---------------------------------------------------------------------------
// Operation rendering
// ---------------------------------------------------------------------------
function ParameterTable({ spec, parameters }: { spec: Spec; parameters: Parameter[] }) {
  const resolved = parameters.map((p) => (p.$ref ? (resolve<Parameter>(spec, p) ?? p) : p)).filter((p) => p.name);
  if (!resolved.length) return null;
  return (
    <DocTable
      dense
      columns={["Name", "In", "Required", "Type", "Description"]}
      rows={resolved.map((p) => [
        <code key={`${p.name}-n`} className="whitespace-nowrap font-mono text-[12px]">
          {p.name}
        </code>,
        <span key={`${p.name}-i`} className="font-mono text-[11.5px] text-mist-400">
          {p.in ?? "—"}
        </span>,
        <span key={`${p.name}-r`} className={p.required ? "text-[11px] font-medium uppercase tracking-wide text-rose-300" : "text-[11px] text-mist-400"}>
          {p.required ? "required" : "optional"}
        </span>,
        <span key={`${p.name}-t`} className="whitespace-nowrap font-mono text-[11.5px] text-mist-400">
          {typeLabel(spec, p.schema)}
          {constraintNote(p.schema) ? <span className="ml-1 text-mist-400">({constraintNote(p.schema)})</span> : null}
        </span>,
        <span key={`${p.name}-d`}>
          <SpecText text={p.description} />
          {enumNote(p.schema) ? <span className="mt-0.5 block font-mono text-[11px] text-mist-400">{enumNote(p.schema)}</span> : null}
        </span>,
      ])}
    />
  );
}

function firstExample(media: MediaType | undefined): unknown {
  if (!media) return undefined;
  if (media.example !== undefined) return media.example;
  const named = media.examples ? Object.values(media.examples)[0] : undefined;
  if (named && named.value !== undefined) return named.value;
  return undefined;
}

function OperationBlock({ spec, method, path, operation }: { spec: Spec; method: string; path: string; operation: Operation }) {
  const anchor = opAnchor(method, path);
  const params = operation.parameters ?? [];
  const body = operation.requestBody?.$ref ? resolve<RequestBody>(spec, operation.requestBody) : operation.requestBody;
  const media = body?.content?.["application/json"] ?? (body?.content ? Object.values(body.content)[0] : undefined);
  const bodySchemaRef = media?.schema?.$ref;
  const example = firstExample(media);
  const responses = Object.entries(operation.responses ?? {});

  return (
    <section id={anchor} className="mt-12 scroll-mt-20 border-t border-night-700 pt-6 first:mt-8">
      <div className="flex flex-wrap items-center gap-2">
        <Method method={method} />
        <code className="font-mono text-[14px] font-medium text-mist-50">{path}</code>
      </div>
      {operation.summary ? <h3 className="!mt-3 !mb-0 text-[16px] font-medium text-mist-50">{operation.summary}</h3> : null}
      {operation.description ? (
        <p className="!mt-2">
          <SpecText text={operation.description} />
        </p>
      ) : null}

      {params.length ? (
        <>
          <div className="mt-6 mb-2.5 font-mono text-[10px] uppercase tracking-[0.16em] text-mist-400">Parameters</div>
          <ParameterTable spec={spec} parameters={params} />
        </>
      ) : null}

      {body ? (
        <>
          <div className="mt-6 mb-2.5 font-mono text-[10px] uppercase tracking-[0.16em] text-mist-400">
            Request body
            {body.required ? <span className="ml-2 text-rose-300">required</span> : null}
            {bodySchemaRef ? (
              <>
                <span className="mx-2 text-mist-600">·</span>
                <Link href={`#${schemaAnchor(refName(bodySchemaRef) ?? "")}`} className="font-mono normal-case tracking-normal text-iris">
                  {refName(bodySchemaRef)}
                </Link>
              </>
            ) : null}
          </div>
          {body.description ? (
            <p className="!mt-0">
              <SpecText text={body.description} />
            </p>
          ) : null}
          <PropertyTable spec={spec} schema={media?.schema} />
          {example !== undefined ? <Code caption="Example request" code={pretty(example)} /> : null}
        </>
      ) : null}

      {responses.length ? (
        <>
          <div className="mt-6 mb-2.5 font-mono text-[10px] uppercase tracking-[0.16em] text-mist-400">Responses</div>
          <DocTable
            dense
            columns={["Status", "Description", "Body"]}
            rows={responses.map(([status, raw]) => {
              const response = raw.$ref ? (resolve<ResponseObject>(spec, raw) ?? raw) : raw;
              const responseMedia = response.content?.["application/json"] ?? (response.content ? Object.values(response.content)[0] : undefined);
              const name = refName(responseMedia?.schema?.$ref);
              const code = Number(status);
              const tone = !Number.isFinite(code) ? "text-mist-200" : code < 300 ? "text-lime" : code < 500 ? "text-amber-300" : "text-rose-300";
              return [
                <span key={`${status}-s`} className={`whitespace-nowrap font-mono text-[12px] font-medium ${tone}`}>
                  {status}
                </span>,
                <SpecText key={`${status}-d`} text={response.description ?? (raw.$ref ? refName(raw.$ref) : undefined)} />,
                name ? (
                  <Link key={`${status}-b`} href={`#${schemaAnchor(name)}`} className="font-mono text-[11.5px]">
                    {name}
                  </Link>
                ) : (
                  <span key={`${status}-b`} className="text-mist-600">
                    —
                  </span>
                ),
              ];
            })}
          />
        </>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Spec loading
// ---------------------------------------------------------------------------
async function loadSpec(): Promise<{ spec: Spec } | { error: string }> {
  try {
    const res = await fetch(`${API_INTERNAL_URL}/openapi.json`, { cache: "no-store", headers: { accept: "application/json" } });
    if (!res.ok) return { error: `The API responded with HTTP ${res.status}.` };
    const parsed: unknown = await res.json();
    if (!isRecord(parsed) || !isRecord(parsed["paths"])) return { error: "The document that was returned is not a usable OpenAPI description." };
    return { spec: parsed as Spec };
  } catch {
    return { error: "The specification could not be fetched from the API." };
  }
}

interface OperationEntry {
  method: string;
  path: string;
  operation: Operation;
}

function groupByTag(spec: Spec): Array<{ tag: string; description?: string; operations: OperationEntry[] }> {
  const groups = new Map<string, OperationEntry[]>();
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    if (!isRecord(item)) continue;
    for (const method of HTTP_METHODS) {
      const raw = item[method];
      if (!isRecord(raw)) continue;
      const operation = raw as Operation;
      const tag = operation.tags?.[0] ?? "Other";
      const list = groups.get(tag) ?? [];
      list.push({ method, path, operation });
      groups.set(tag, list);
    }
  }
  // Declared tag order first, then anything else alphabetically.
  const declared = (spec.tags ?? []).map((t) => t.name).filter((n): n is string => typeof n === "string");
  const rest = [...groups.keys()].filter((t) => !declared.includes(t)).sort();
  return [...declared, ...rest]
    .filter((tag) => groups.has(tag))
    .map((tag) => ({
      tag,
      description: spec.tags?.find((t) => t.name === tag)?.description,
      operations: groups.get(tag) ?? [],
    }));
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default async function ApiReferencePage() {
  const result = await loadSpec();

  if ("error" in result) {
    return (
      <>
        <DocHeader eyebrow="Reference" title="API reference" lead="Every NATIO endpoint, rendered from the published OpenAPI 3.1 document." />
        <Note tone="warn" title="The live specification could not be loaded">
          {result.error} The OpenAPI 3.1 document is published at <Link href="/openapi.json">/openapi.json</Link> — open it directly, or point a generator at it, while this
          page is unavailable.
        </Note>
        <p>
          The narrative guides do not depend on this page: <Link href="/docs/quickstart">Quickstart</Link>, <Link href="/docs/payments">Payments</Link>,{" "}
          <Link href="/docs/webhooks">Webhooks</Link> and <Link href="/docs/errors">Errors</Link> carry their own request and response examples.
        </p>
      </>
    );
  }

  const spec = result.spec;
  const groups = groupByTag(spec);
  const schemas = Object.entries(spec.components?.schemas ?? {});
  const securitySchemes = Object.entries(spec.components?.securitySchemes ?? {});
  const globalSecurity = (spec.security ?? []).flatMap((entry) => Object.keys(entry));
  const operationCount = groups.reduce((sum, g) => sum + g.operations.length, 0);

  return (
    <>
      <DocHeader
        eyebrow="Reference"
        title="API reference"
        lead={
          <>
            {spec.info?.description ??
              "One integration for payments, payouts, transactions and settlements across multiple providers."}
          </>
        }
      />

      <Note tone="info" title="Rendered from the live specification">
        This page is generated at request time from the OpenAPI {spec.openapi ?? "3.1"} document served by the API — {operationCount} operations across {groups.length} tag
        groups. The raw document is at <Link href="/openapi.json">/openapi.json</Link>.
      </Note>

      <H2 id="servers">Servers</H2>
      {spec.servers?.length ? (
        <DocTable
          columns={["URL", "Environment"]}
          rows={spec.servers.map((s) => [
            <code key={s.url} className="font-mono text-[12.5px]">
              {s.url}
            </code>,
            s.description ?? "—",
          ])}
        />
      ) : (
        <p>The document does not declare any servers.</p>
      )}

      <H2 id="authentication">Authentication</H2>
      {securitySchemes.length ? (
        <>
          <DocTable
            columns={["Scheme", "Type", "How it is sent", "Notes"]}
            rows={securitySchemes.map(([name, scheme]) => [
              <Tok key={name}>{name}</Tok>,
              <span key={`${name}-t`} className="font-mono text-[11.5px] text-mist-400">
                {[scheme.type, scheme.scheme].filter(Boolean).join(" · ") || "—"}
              </span>,
              <span key={`${name}-h`} className="font-mono text-[11.5px] text-mist-400">
                {scheme.type === "http" && scheme.scheme === "bearer"
                  ? "Authorization: Bearer <key>"
                  : scheme.name
                    ? `${scheme.name}${scheme.in ? ` (${scheme.in})` : ""}`
                    : "—"}
              </span>,
              <SpecText key={`${name}-d`} text={scheme.description} />,
            ])}
          />
          {globalSecurity.length ? (
            <p>
              Every operation requires{" "}
              {globalSecurity.map((name, i) => (
                <span key={name}>
                  {i > 0 ? ", " : ""}
                  <Tok>{name}</Tok>
                </span>
              ))}{" "}
              unless it says otherwise. See <Link href="/docs/authentication">Authentication</Link> for key modes, rotation and IP allow-lists.
            </p>
          ) : null}
        </>
      ) : (
        <p>The document does not declare a security scheme.</p>
      )}

      <H2 id="index">Index</H2>
      <div className="mb-6 grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2">
        {groups.map((group) => (
          <div key={group.tag}>
            <div className="mb-2.5 font-mono text-[10px] uppercase tracking-[0.16em] text-mist-400">
              <Link href={`#tag-${slug(group.tag)}`} className="!text-mist-400 !no-underline hover:!text-mist-50">
                {group.tag}
              </Link>
            </div>
            <ul className="!mb-0 !list-none !pl-0">
              {group.operations.map((op) => (
                <li key={`${op.method}-${op.path}`} className="flex items-baseline gap-2 py-[2px]">
                  <span className="w-[46px] shrink-0 text-right font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-mist-400">{op.method}</span>
                  <Link href={`#${opAnchor(op.method, op.path)}`} className="font-mono !text-[12px] !no-underline hover:!underline">
                    {op.path}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {groups.map((group) => (
        <div key={group.tag}>
          <H2 id={`tag-${slug(group.tag)}`}>{group.tag}</H2>
          {group.description ? (
            <p>
              <SpecText text={group.description} />
            </p>
          ) : null}
          {group.operations.map((op) => (
            <OperationBlock key={`${op.method}-${op.path}`} spec={spec} method={op.method} path={op.path} operation={op.operation} />
          ))}
        </div>
      ))}

      {schemas.length ? (
        <>
          <H2 id="schemas">Schemas</H2>
          <p>
            The component schemas referenced above. Every <Tok>$ref</Tok> in the document points into this section.
          </p>
          {schemas.map(([name, schema]) => (
            <SchemaBlock key={name} spec={spec} name={name} schema={schema} />
          ))}
        </>
      ) : null}
    </>
  );
}

function SchemaBlock({ spec, name, schema }: { spec: Spec; name: string; schema: JsonSchema }): ReactNode {
  const rows = propertyRows(spec, schema);
  const enums = enumNote(schema);
  return (
    <section id={schemaAnchor(name)} className="mt-8 scroll-mt-20 border-t border-night-700 pt-5">
      <h3 className="!mt-0 !mb-1 font-mono text-[15px] font-medium text-mist-50">{name}</h3>
      {schema.description ? (
        <p className="!mt-1">
          <SpecText text={schema.description} />
        </p>
      ) : null}
      {rows.length ? (
        <PropertyTable spec={spec} schema={schema} />
      ) : enums ? (
        <p className="!mt-1">
          <span className="font-mono text-[12px] text-mist-400">{typeLabel(spec, schema)}</span>
          <span className="mx-2 text-mist-600">·</span>
          <span className="font-mono text-[12px] text-mist-400">{enums}</span>
        </p>
      ) : (
        <p className="!mt-1 font-mono text-[12px] text-mist-400">{typeLabel(spec, schema)}</p>
      )}
    </section>
  );
}
