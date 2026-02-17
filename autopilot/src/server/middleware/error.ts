// Express error-handling middleware for the ResponseServer.
// Must have 4 parameters for Express to recognize it as an error handler.

import type { Request, Response, NextFunction } from 'express';

/**
 * Catches unhandled errors in route handlers and returns a 500 JSON response.
 *
 * Express 5 automatically forwards rejected promises from async handlers
 * to this middleware, so explicit try-catch in routes is unnecessary.
 */
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  console.error(err.stack ?? err.message);
  res.status(500).json({ error: 'Internal server error' });
}
