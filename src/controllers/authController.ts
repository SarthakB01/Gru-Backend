// src/controllers/authController.ts
import { Request, Response } from 'express';
import { findUserByUsername, addUser } from '../models/userModel';
import bcrypt from 'bcryptjs';
import { generateToken } from '../utils/jwt';

export const signup = async (req: Request, res: Response): Promise<void> => {
  const { username, password } = req.body;

  // Check if the user already exists
  const existingUser = findUserByUsername(username);
  if (existingUser) {
    res.status(400).json({ error: 'User already exists' });
    return;
  }

  // Hash the password
  const hashedPassword = await bcrypt.hash(password, 10);

  // Add the new user
  addUser({ username, password: hashedPassword });

  // Generate a JWT token
  const token = generateToken(username);

  res.status(201).json({ message: 'User created successfully', token });
};

export const login = async (req: Request, res: Response): Promise<void> => {
  const { username, password } = req.body;

  // Find the user by username
  const user = findUserByUsername(username);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  // Compare the password with the stored hashed password
  const isPasswordValid = await bcrypt.compare(password, user.password);
  if (!isPasswordValid) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  // Generate a JWT token
  const token = generateToken(username);

  res.status(200).json({ message: 'Login successful', token });
};
