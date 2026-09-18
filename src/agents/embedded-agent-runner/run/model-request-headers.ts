import type { Model } from "../../../llm/types.js";
import { mergeTransportHeaders } from "../../transport-stream-shared.js";

export function applyModelRequestHeaders(model: Model, headers?: Record<string, string>): Model {
  if (!headers) {
    return model;
  }

  return {
    ...model,
    headers: mergeTransportHeaders(model.headers, headers),
  };
}
