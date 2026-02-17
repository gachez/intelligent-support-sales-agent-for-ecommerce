import { Request, Response, NextFunction } from "express";

/**
 * Logs all incoming requests with method, path, status, and duration.
 */
export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const statusColor =
      status >= 500 ? "\x1b[31m" : status >= 400 ? "\x1b[33m" : "\x1b[32m";

    console.log(
      `${statusColor}${req.method}\x1b[0m ${req.path} → ${statusColor}${status}\x1b[0m (${duration}ms)`
    );
  });

  next();
}

/**
 * Global error handler middleware.
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  console.error(`❌ Error on ${req.method} ${req.path}:`, err.message);

  res.status(500).json({
    error: "Internal server error",
    message:
      process.env.NODE_ENV === "development"
        ? err.message
        : "Something went wrong",
  });
}
