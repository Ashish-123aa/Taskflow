import axios, { AxiosError } from 'axios';
import type { ApiError } from './types';

/**
 * `withCredentials: true` is the whole trick to auth here — the API's
 * session lives in an httpOnly cookie (see docs/security.md on the
 * backend), so the frontend never touches a token directly. Every
 * request just needs the browser to attach that cookie, which it will as
 * long as this flag is set and the API's CORS config allows credentials
 * (it does — see apps/api/src/app.ts).
 *
 * baseURL is relative, not an absolute host — see vite.config.ts's dev
 * server proxy, which forwards `/api` to the API container in
 * development. In production, the frontend and API are expected to be
 * served from origins configured so `/api` reaches the right place (see
 * docs/deployment.md, added when that phase lands).
 */
export const api = axios.create({
  baseURL: '/api/v1',
  withCredentials: true,
});

/**
 * Every error thrown by the API follows the same shape (see the backend's
 * middleware/errorHandler.ts) — this pulls that shape out of an Axios
 * error so calling code (and React Query's `error` state) can just read
 * `.message` without unwrapping `error.response.data` everywhere.
 */
export class ApiRequestError extends Error {
  errorCode: string;
  details?: unknown;
  status?: number;

  constructor(apiError: ApiError, status?: number) {
    super(apiError.message);
    this.errorCode = apiError.errorCode;
    this.details = apiError.details;
    this.status = status;
  }
}

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ApiError>) => {
    if (error.response?.data && typeof error.response.data === 'object') {
      return Promise.reject(new ApiRequestError(error.response.data, error.response.status));
    }
    return Promise.reject(error);
  },
);
