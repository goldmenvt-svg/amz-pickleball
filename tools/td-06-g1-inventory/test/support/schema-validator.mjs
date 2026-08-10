function resolveReference(root, reference) {
  if (!reference.startsWith("#/")) throw new Error(`Unsupported schema reference: ${reference}`);
  return reference
    .slice(2)
    .split("/")
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))
    .reduce((value, part) => value?.[part], root);
}

function matchesType(value, type) {
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "array") return Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "null") return value === null;
  return typeof value === type;
}

function isDateTime(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

export function validateJsonSchema(root, value) {
  const errors = [];

  function visit(schema, current, path) {
    if (schema.oneOf) {
      let matches = 0;
      for (const candidate of schema.oneOf) {
        const before = errors.length;
        visit(candidate, current, path);
        const candidateErrors = errors.splice(before);
        if (candidateErrors.length === 0) matches += 1;
      }
      if (matches !== 1) errors.push(`${path}: expected exactly one oneOf match`);
      return;
    }

    if (schema.$ref) {
      const target = resolveReference(root, schema.$ref);
      if (!target) errors.push(`${path}: unresolved reference ${schema.$ref}`);
      else visit(target, current, path);
      return;
    }

    if (Object.hasOwn(schema, "const") && !Object.is(current, schema.const)) {
      errors.push(`${path}: const mismatch`);
    }
    if (schema.enum && !schema.enum.some((item) => Object.is(item, current))) {
      errors.push(`${path}: value is outside enum`);
    }

    if (schema.type && !matchesType(current, schema.type)) {
      errors.push(`${path}: expected ${schema.type}`);
      return;
    }

    if (typeof current === "number" && schema.minimum !== undefined && current < schema.minimum) {
      errors.push(`${path}: below minimum ${schema.minimum}`);
    }

    if (typeof current === "string") {
      if (schema.pattern && !new RegExp(schema.pattern).test(current)) {
        errors.push(`${path}: pattern mismatch`);
      }
      if (schema.format === "date-time" && !isDateTime(current)) {
        errors.push(`${path}: invalid date-time`);
      }
    }

    if (Array.isArray(current) && schema.items) {
      current.forEach((item, index) => visit(schema.items, item, `${path}[${index}]`));
    }

    if (current !== null && typeof current === "object" && !Array.isArray(current)) {
      for (const required of schema.required ?? []) {
        if (!Object.hasOwn(current, required)) errors.push(`${path}: missing ${required}`);
      }
      const properties = schema.properties ?? {};
      for (const [key, item] of Object.entries(current)) {
        if (Object.hasOwn(properties, key)) {
          visit(properties[key], item, `${path}.${key}`);
        } else if (schema.additionalProperties === false) {
          errors.push(`${path}: unexpected ${key}`);
        } else if (
          schema.additionalProperties &&
          typeof schema.additionalProperties === "object"
        ) {
          visit(schema.additionalProperties, item, `${path}.${key}`);
        }
      }
    }
  }

  visit(root, value, "$");
  return errors;
}
