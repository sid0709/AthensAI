import type { JsonSchemaDefinition } from "./chat-types";

export const FORM_ACTION_PLAN_SCHEMA: JsonSchemaDefinition = {
  name: "form_action_plan",
  description: "Automation action plan for each form field on a job application page",
  strict: true,
  schema: {
    type: "object",
    properties: {
      fields: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "Field id from input (groupIndex:childIndex)" },
            action: {
              type: "string",
              enum: ["Click", "Typing", "SelectOption", "FileUpload", "Check", "Uncheck"],
            },
            shouldSkip: { type: "string", enum: ["Yes", "No"] },
            value: { type: "string", description: "Text to type, exact option label, or N/A for Click / skip" },
            notes: { type: "string", description: "Brief rationale (profile source, why skip, etc.)" },
          },
          required: ["id", "action", "shouldSkip", "value", "notes"],
          additionalProperties: false,
        },
      },
    },
    required: ["fields"],
    additionalProperties: false,
  },
};
