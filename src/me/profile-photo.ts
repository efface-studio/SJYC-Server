import sharp from 'sharp';
import { z } from 'zod';
import { AppException } from '../common/app-exception';

const prefix = 'data:image/jpeg;base64,';
export const photoInput = z.object({
  image: z
    .string()
    .max(90_000)
    .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/)
    .nullable(),
});

export async function normalizePhoto(image: string): Promise<string> {
  try {
    const bytes = Buffer.from(image.slice(prefix.length), 'base64');
    const photo = sharp(bytes, { limitInputPixels: 1_048_576, failOn: 'warning' });
    if ((await photo.metadata()).format !== 'jpeg') throw new Error('format');
    const encoded = await photo.rotate().resize(256, 256, { fit: 'cover' }).jpeg({ quality: 80 }).toBuffer();
    return prefix + encoded.toString('base64');
  } catch {
    throw new AppException('VALIDATION', '읽을 수 있는 사진을 선택해 주세요.');
  }
}
