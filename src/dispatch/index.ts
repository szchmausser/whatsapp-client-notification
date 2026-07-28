export { classifyDispatch } from "./classifier.js";
export { extractDispatchFields } from "./extractor.js";
export { matchCompany } from "./matcher.js";
export { default as companies } from "./companies.json";

export type {
  DispatchFields,
  ClassificationResult,
  MatcherResult,
  Company,
} from "./types.js";
