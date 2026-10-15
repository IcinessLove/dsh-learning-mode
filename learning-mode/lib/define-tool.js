/**
 * Local stand-in for `defineTool` from `@deepseek-ai/dsh-tools`.
 *
 * `defineTool` is a pure constructor: it compiles the author-facing schema DSL
 * into plain JSON Schema and returns
 * `{ name, description, parameters, output: { schema, render }, execute }`,
 * which is exactly what `ctx.tools.register()` consumes. A workspace bundle that
 * declares no dependencies on the installation's packages must not import it, so
 * this module reproduces the compile step with node builtins only.
 *
 * DSL rules reproduced here:
 *   - a parameter spec is an implicit property map (`{ action: { type, required } }`);
 *   - every property may carry `required: true`, compiled into the parent's
 *     standard `required: [...]` array;
 *   - `type`, `enum`, `const`, `oneOf`, `items`, `properties`,
 *     `additionalProperties` and annotations pass through recursively.
 */

function isPlainSpec(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Compile one value-schema node (object, array, scalar or oneOf branch). */
export function compileValueSpec(spec) {
  if (!isPlainSpec(spec)) return spec;
  const node = {};
  for (const [key, value] of Object.entries(spec)) {
    if (key === 'required') continue; // consumed by the enclosing property map
    if (key === 'properties') {
      const compiled = compilePropertyMap(value);
      node.properties = compiled.properties;
      if (compiled.required.length > 0) node.required = compiled.required;
      continue;
    }
    if (key === 'items') {
      node.items = compileValueSpec(value);
      continue;
    }
    if (key === 'oneOf') {
      node.oneOf = Array.isArray(value) ? value.map(compileValueSpec) : value;
      continue;
    }
    node[key] = value;
  }
  return node;
}

/** Compile an implicit property map into `{ properties, required[] }`. */
export function compilePropertyMap(spec) {
  const properties = {};
  const required = [];
  for (const [key, raw] of Object.entries(spec ?? {})) {
    if (!isPlainSpec(raw)) continue;
    const { required: isRequired, ...rest } = raw;
    properties[key] = compileValueSpec(rest);
    if (isRequired === true) required.push(key);
  }
  return { properties, required };
}

/** Compile the tool's parameter spec into a JSON Schema object. */
export function compileParameters(spec) {
  const compiled = compilePropertyMap(spec);
  return {
    type: 'object',
    properties: compiled.properties,
    ...compiled.required.length > 0 ? { required: compiled.required } : {},
  };
}

/**
 * Build a tool definition the registry accepts.
 * @param options - author-facing definition (name, description, parameters,
 *   output.schema, output.render, execute, plus optional passthroughs).
 * @returns the compiled tool definition.
 */
export function defineTool(options) {
  const parameters = compileParameters(options.parameters);
  const schema = compileValueSpec(options.output.schema);
  const render = options.output.render;
  const tool = {
    name: options.name,
    description: options.description,
    parameters,
    output: {
      schema,
      render(args, value) {
        return render(args, value);
      },
    },
    async execute(args, exec) {
      const missing = (parameters.required ?? []).filter((key) => args === null || typeof args !== 'object' || args[key] === undefined);
      if (missing.length > 0) throw new Error(`${options.name}: 缺少必需参数 ${missing.join(', ')}`);
      return options.execute(args, exec);
    },
  };
  if (options.presentCall !== undefined) tool.presentCall = options.presentCall;
  if (options.isConcurrencySafe !== undefined) tool.isConcurrencySafe = options.isConcurrencySafe;
  if (options.timeoutMs !== undefined) tool.timeoutMs = options.timeoutMs;
  return tool;
}
