import { validateOpenAISchema } from "../../../lib/openai-schema-validator/validator";

const INVALID_REQUEST = {
  error: {
    code: "invalid_request",
    message: "A schema string or object is required.",
  },
} as const;

function invalidRequest(): Response {
  return Response.json(INVALID_REQUEST, { status: 400 });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return invalidRequest();
  }

  if (!isObject(body) || !hasOwn(body, "schema")) {
    return invalidRequest();
  }

  const schema = body.schema;
  if (
    schema === null ||
    (typeof schema !== "string" && typeof schema !== "object")
  ) {
    return invalidRequest();
  }

  return Response.json(validateOpenAISchema(schema));
}
