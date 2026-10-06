import { mockServices } from "./mock";
import { apiServices } from "./api";
import { API_MODE, REAL_AUTH, realAuth } from "./real-auth";
import type { Services } from "./types";

/**
 * Single composition point. Swap `mockServices` for the FastAPI
 * implementation in Phases 4-6; no UI code needs to change.
 */
export const services: Services = API_MODE ? { ...mockServices, ...apiServices, auth: realAuth } : mockServices;
export { API_MODE, REAL_AUTH };
export * from "./types";
