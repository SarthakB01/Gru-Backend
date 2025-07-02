import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import aiRoutes from './routes/ai';

const app = express();
const PORT = 5000;

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Create uploads directory if it doesn't exist
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)){
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Create unique filename with original extension
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    // Accept images and PDFs
    if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(null, false);
    }
  }
});

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cors({
  origin: 'http://localhost:3000' // Your frontend URL
}));

// Make uploads directory accessible
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// AI routes
app.use('/api/ai', aiRoutes);

// Root route
app.get('/', (req: Request, res: Response) => {
  res.send('Hello World!');
});

// Text message endpoint
app.post('/api/message', (req: Request, res: Response) => {
  const { message } = req.body;
  console.log('Text message received:', message);
  
  res.json({ 
    success: true, 
    serverResponse: `Backend received text: "${message}"` 
  });
});

// File upload endpoint
app.post('/api/upload', upload.single('file'), (req: Request & { file?: Express.Multer.File }, res: Response) => {
  if (!req.file) {
    res.status(400).json({ success: false, message: 'No file uploaded' });
    return;
  }
  
  const file = req.file;
  console.log('File received:', file.originalname, file.mimetype, file.size);
  
  res.json({
    success: true,
    serverResponse: `File uploaded successfully: ${file.originalname}`,
    fileDetails: {
      name: file.originalname,
      type: file.mimetype,
      size: file.size,
      path: `/uploads/${file.filename}` // URL to access the file
    }
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
});