import express, { Request, Response } from 'express';
import cors from 'cors';

import multer from 'multer';
import path from 'path';


const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
      cb(null, `${Date.now()}-${file.originalname}`);
    },
  });
  
  const upload = multer({ storage });
  

app.get('/', (req, res) => {
  res.send('Server is up and running!');
});

app.post('/upload', upload.single('file'), (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }
  
    console.log('File received:', req.file.filename);
    res.json({ message: 'File uploaded successfully', filename: req.file.filename });
  });
  




app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
