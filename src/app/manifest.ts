import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "OpenAI JSON Schema Validator",
    short_name: "Schema Signal",
    description:
      "Validate JSON Schemas for OpenAI Structured Outputs and review strict-mode patches.",
    start_url: "/",
    display: "standalone",
    background_color: "#eee8dc",
    theme_color: "#1b1d1a",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
