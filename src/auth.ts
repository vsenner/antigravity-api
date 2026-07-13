import type { Request, Response, NextFunction } from "express";

export function bearerToken(req: Request): string | undefined {
  const header = req.header("authorization");
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1];
}

export function requireBearer(allowed: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = bearerToken(req);
    if (!token || !allowed.includes(token)) {
      return res.status(401).json({ error: { message: "Unauthorized", type: "auth_error" } });
    }
    return next();
  };
}
