import {
  Controller, Post, Param, UploadedFile, UseInterceptors, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';

// folders we allow uploading into (keeps things organized & safe)
const ALLOWED_FOLDERS = ['products', 'categories', 'banners', 'users', 'reviews', 'delivery_partners', 'admin_users', 'support_tickets', 'misc'];

// where files are saved on the server.
// __dirname at runtime = dist/upload, so go up to project root then into public/uploads
const UPLOAD_ROOT = join(process.cwd(), 'public', 'uploads');

// public base URL the browser will use to load the file
const PUBLIC_BASE = process.env.PUBLIC_UPLOAD_BASE || 'https://bitestheory.com/api/uploads';

function safeName(original: string): string {
  const ext = extname(original).toLowerCase();
  const rand = Date.now() + '-' + Math.round(Math.random() * 1e9);
  return `${rand}${ext}`;
}

@Controller('upload')
export class UploadController {
  @Post(':folder')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const folder = (req.params as any).folder;
          const dir = join(UPLOAD_ROOT, ALLOWED_FOLDERS.includes(folder) ? folder : 'misc');
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (req, file, cb) => cb(null, safeName(file.originalname)),
      }),
      limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB max (covers short videos)
      fileFilter: (req, file, cb) => {
        const ok = /^(image\/(jpe?g|png|webp|gif|avif)|video\/(mp4|webm|quicktime))$/.test(file.mimetype);
        if (!ok) return cb(new BadRequestException('Only image or video files are allowed'), false);
        cb(null, true);
      },
    }),
  )
  uploadFile(@Param('folder') folder: string, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file received');
    const safeFolder = ALLOWED_FOLDERS.includes(folder) ? folder : 'misc';
    const url = `${PUBLIC_BASE}/${safeFolder}/${file.filename}`;
    return {
      url,
      filename: file.filename,
      type: file.mimetype.startsWith('video') ? 'video' : 'image',
      size: file.size,
    };
  }
}
