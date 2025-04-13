// src/utils/jwt.ts
import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || 'super-secret-key';

export const generateToken = (username: string) => {
  return jwt.sign({ username }, SECRET, { expiresIn: '1h' });
};

export const verifyToken = (token: string) => {
  return jwt.verify(token, SECRET);
};
