import {
  Controller, Post, Param, UploadedFile, UseInterceptors, BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage, diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { v2 as cloudinary } from 'cloudinary';
import * as streamifier from 'streamifier';

/**
 * Upload strategy:
 * - CLOUDINARY_* env vars set  → stream to Cloudinary (persistent, CDN).
 *   REQUIRED in production: Render's disk is ephemeral — local files die on redeploy.
 * - Not set (local dev)        → fall back to disk exactly as before.
 */
const ALLOWED_FOLDERS = ['products', 'categories', 'banners', 'users', 'reviews',
  'delivery_partners', 'admin_users', 'support_tickets', 'misc'];

const UPLOAD_ROOT = join(process.cwd(), 'public', 'uploads');
const PUBLIC_BASE = process.env.PUBLIC_UPLOAD_BASE || 'https://bitestheory.com/api/uploads';

const CLOUD_ENABLED = !!(process.env.CLOUDINARY_CLOUD_NAME
  && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);

if (CLOUD_ENABLED) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

function safeName(original: string): string {
  const ext = extname(original).toLowerCase();
  return `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
}

function uploadToCloudinary(buffer: Buffer, folder: string, isVideo: boolean): Promise<any> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: `bite-theory/${folder}`,
        resource_type: isVideo ? 'video' : 'image',
        // auto-optimize images on delivery (quality + format)
        ...(isVideo ? {} : { transformation: [{ quality: 'auto', fetch_format: 'auto' }] }),
      },
      (err, result) => (err ? reject(err) : resolve(result)),
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });
}

@Controller('upload')
export class UploadController {
  @Post(':folder')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(), // buffer in memory; we decide destination below
      limits: { fileSize: 50 * 1024 * 1024 },
      fileFilter: (req, file, cb) => {
        const ok = /^(image\/(jpe?g|png|webp|gif|avif)|video\/(mp4|webm|quicktime))$/.test(file.mimetype);
        if (!ok) return cb(new BadRequestException('Only image or video files are allowed'), false);
        cb(null, true);
      },
    }),
  )
  async uploadFile(@Param('folder') folder: string, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file received');
    const safeFolder = ALLOWED_FOLDERS.includes(folder) ? folder : 'misc';
    const isVideo = file.mimetype.startsWith('video');

    /* ── production path: Cloudinary ── */
    if (CLOUD_ENABLED) {
      try {
        const res = await uploadToCloudinary(file.buffer, safeFolder, isVideo);
        return {
          url: res.secure_url,
          filename: res.public_id,
          type: isVideo ? 'video' : 'image',
          size: file.size,
          storage: 'cloudinary',
        };
      } catch (e: any) {
        throw new InternalServerErrorException(`Cloudinary upload failed: ${e?.message || e}`);
      }
    }

    /* ── local-dev fallback: disk (unchanged behaviour) ── */
    const dir = join(UPLOAD_ROOT, safeFolder);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const filename = safeName(file.originalname);
    writeFileSync(join(dir, filename), file.buffer);
    return {
      url: `${PUBLIC_BASE}/${safeFolder}/${filename}`,
      filename,
      type: isVideo ? 'video' : 'image',
      size: file.size,
      storage: 'disk',
    };
  }
}
