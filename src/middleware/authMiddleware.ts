// src/middleware/authMiddleware.ts
import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt';

declare global {
  namespace Express {
    interface Request {
      user?: any;
    }
  }
}

export const authenticate = (req: Request, res: Response, next: NextFunction): void => {
  const token = req.headers['authorization']?.split(' ')[1]; // Assuming the token is in the Authorization header as Bearer token
  
  if (!token) {
    // Sending a response here but not returning it
    res.status(403).json({ error: 'No token provided' });
    return; // Don't call next() if there's an error, just return after sending the response
  }

  try {
    const decoded = verifyToken(token);
    req.user = decoded; // Attach decoded user info to request
    next(); // Pass control to the next middleware/handler
  } catch (error) {
    // Sending a response here but not returning it
    res.status(401).json({ error: 'Invalid token' });
    return; // Don't call next() if there's an error, just return after sending the response
  }
};
