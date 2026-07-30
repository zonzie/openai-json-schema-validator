import { validateOpenAISchema } from "../../../lib/openai-schema-validator/validator";

export async function POST(request: Request): Promise<Response> {
  let body: { schema?: unknown };

  try {
    body = (await request.json()) as { schema?: unknown };
  } catch {
    return Response.json(
      {
        error: {
          code: "invalid_request",
          message: "The request body must be valid JSON.",
        },
      },
      { status: 400 },
    );
  }

  if (
    body.schema === null ||
    (typeof body.schema !== "string" && typeof body.schema !== "object")
  ) {
    return Response.json(
      {
        error: {
          code: "invalid_request",
          message: "A schema string or object is required.",
        },
      },
      { status: 400 },
    );
  }

  return Response.json(validateOpenAISchema(body.schema));
}
