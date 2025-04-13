import express from 'express';
import { login, signup } from '../controllers/authController';
import { authenticate } from '../middleware/authMiddleware'; // Import the authenticate middleware

const router = express.Router();

// Route handlers are asynchronous, so we don't need `express.RequestHandler`
router.post('/signup', signup);
router.post('/login', login);

// Protected route that requires authentication
router.get('/profile', authenticate, (req, res) => {
  res.json({ message: 'This is a protected profile route', user: req.user });
});

export default router;
