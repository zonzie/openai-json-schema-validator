import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "OpenAI JSON Schema Validator",
    short_name: "Schema Signal",
    description:
      "Validate and safely repair JSON Schemas for OpenAI Structured Outputs.",
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
