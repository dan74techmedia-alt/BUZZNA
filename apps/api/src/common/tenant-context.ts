import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';

export interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    tenantId: string;
    roleId: string;
  };
}

export const enforceTenantContext = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    // Cryptographically verify the signature using the environment secret
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as any;

    // Attach verified claims to the internal request object
    // Client-supplied tenant headers are completely ignored
    req.user = {
      userId: decoded.userId,
      tenantId: decoded.tenantId,
      roleId: decoded.roleId,
    };

    next();
  } catch (error) {
    return res.status(403).json({ error: 'Token verification failed. Access denied.' });
  }
};