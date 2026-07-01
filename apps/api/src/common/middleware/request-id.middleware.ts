import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const reqId = (req.headers['x-request-id'] as string) || uuidv4();
  
  // Attach to request object for internal logger use
  req.id = reqId;
  
  // Send back in response for client-side diagnostic tracing
  res.setHeader('X-Request-Id', reqId);
  
  next();
};