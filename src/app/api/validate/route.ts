import { validateOpenAISchema } from "../../../lib/openai-schema-validator/validator";

export const MAX_REQUEST_BODY_BYTES = 1_000_000;
export const MAX_RESPONSE_BODY_BYTES = 512_000;

const INVALID_REQUEST = {
  error: {
    code: "invalid_request",
    message: "A schema string or object is required.",
  },
} as const;

const PAYLOAD_TOO_LARGE = {
  error: {
    code: "payload_too_large",
    message: "Request body must not exceed 1,000,000 bytes.",
  },
} as const;

const VALIDATION_RESULT_TOO_LARGE = {
  error: {
    code: "validation_result_too_large",
    message: "The validation result exceeds the response size limit.",
  },
} as const;

function invalidRequest(): Response {
  return Response.json(INVALID_REQUEST, { status: 400 });
}

function payloadTooLarge(): Response {
  return Response.json(PAYLOAD_TOO_LARGE, { status: 413 });
}

function jsonResponse(serializedBody: string, status = 200): Response {
  return new Response(serializedBody, {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function responseByteLength(serializedBody: string): number {
  return new TextEncoder().encode(serializedBody).byteLength;
}

function boundedValidationResponse(result: unknown): Response {
  const serializedResult = JSON.stringify(result);
  if (responseByteLength(serializedResult) <= MAX_RESPONSE_BODY_BYTES) {
    return jsonResponse(serializedResult);
  }

  if (isObject(result) && result.fixedSchema !== null) {
    const withoutFixedSchema = JSON.stringify({
      ...result,
      fixedSchema: null,
      fixedSchemaOmitted: true,
    });

    if (responseByteLength(withoutFixedSchema) <= MAX_RESPONSE_BODY_BYTES) {
      return jsonResponse(withoutFixedSchema);
    }
  }

  return Response.json(VALIDATION_RESULT_TOO_LARGE, { status: 422 });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

async function readRequestBody(
  request: Request,
): Promise<{ text: string; tooLarge: false } | { tooLarge: true }> {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BODY_BYTES) {
    return { tooLarge: true };
  }

  if (!request.body) {
    return { text: "", tooLarge: false };
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      totalBytes += value.byteLength;
      if (totalBytes > MAX_REQUEST_BODY_BYTES) {
        await reader.cancel();
        return { tooLarge: true };
      }

      chunks.push(decoder.decode(value, { stream: true }));
    }

    chunks.push(decoder.decode());
    return { text: chunks.join(""), tooLarge: false };
  } finally {
    reader.releaseLock();
  }
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  const requestBody = await readRequestBody(request);

  if (requestBody.tooLarge) {
    return payloadTooLarge();
  }

  try {
    body = JSON.parse(requestBody.text) as unknown;
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

  return boundedValidationResponse(validateOpenAISchema(schema));
}
