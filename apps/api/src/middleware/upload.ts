import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import multer from 'multer';
import { env } from '../config/env';
import { ValidationError } from '../utils/errors';

// Ensure the upload directory exists before multer tries to write into it
// (a fresh container/volume won't have it yet).
fs.mkdirSync(env.UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, env.UPLOAD_DIR),
  filename: (_req, file, cb) => {
    // The stored filename is always a fresh random UUID — never derived
    // from the client-supplied name. That's the actual defense against
    // path traversal (section 35: "do not trust the filename supplied by
    // the client"); the original filename is kept only as display
    // metadata in the job payload, never used to build a filesystem path.
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${randomUUID()}${ext}`);
  },
});

const maxSizeBytes = env.MAX_UPLOAD_SIZE_MB * 1024 * 1024;

export const uploadCsv = multer({
  storage,
  limits: { fileSize: maxSizeBytes },
  fileFilter: (_req, file, cb) => {
    const allowedMimeTypes = ['text/csv', 'application/vnd.ms-excel', 'application/csv'];
    const hasCsvExtension = file.originalname.toLowerCase().endsWith('.csv');
    if (!allowedMimeTypes.includes(file.mimetype) && !hasCsvExtension) {
      cb(new ValidationError('Only CSV files are accepted'));
      return;
    }
    cb(null, true);
  },
}).single('file');

export const uploadImage = multer({
  storage,
  limits: { fileSize: maxSizeBytes },
  fileFilter: (_req, file, cb) => {
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      cb(new ValidationError('Only JPEG, PNG, or WebP images are accepted'));
      return;
    }
    cb(null, true);
  },
}).single('file');
