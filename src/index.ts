import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import { requireAuth } from '@clerk/express';
import uploadRoutes from './routes/upload';

dotenv.config();

const app = express();

// Enable CORS - add this before other middleware
app.use(cors({
  origin: 'http://localhost:3000', // Your frontend URL
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Fix the route path - this is the issue causing the 404 error
app.use('/upload', uploadRoutes); // Changed from '/api' to '/upload'

app.get('/', (req, res) => {
  res.send('Hello from backend');
});

// Add this at the end of index.ts before app.listen()
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Global error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Add this to your index.ts
console.log("Clerk environment check:", {
  secretKeyConfigured: !!process.env.CLERK_SECRET_KEY,
  secretKeyLength: process.env.CLERK_SECRET_KEY?.length || 0
});

// In index.ts, add this express error handler at the end before app.listen()
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('SERVER ERROR:', err);
  console.error('Error stack:', err.stack);
  res.status(500).json({ 
    error: 'Internal server error', 
    message: err.message 
  });
});















const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});