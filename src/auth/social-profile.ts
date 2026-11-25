import { z } from 'zod';

const text = z.string().nullish();
export interface ProviderProfile {
  subject: string;
  name?: string;
  email?: string;
  verifiedEmail?: string;
  phone?: string;
  birthDate?: string;
}

export function appleProfile(
  payload: { sub?: string; email?: unknown; email_verified?: unknown },
  name?: string,
): ProviderProfile {
  const subject = z.string().min(1).max(255).parse(payload.sub);
  const email = z.email().safeParse(payload.email);
  const address = email.success ? email.data.toLowerCase() : undefined;
  return {
    subject,
    name,
    email: address,
    verifiedEmail: payload.email_verified === true || payload.email_verified === 'true' ? address : undefined,
  };
}

function birthday(year?: string | null, day?: string | null) {
  const md = day?.replace('-', '');
  const date = year && md?.length === 4 ? year + '-' + md.slice(0, 2) + '-' + md.slice(2) : '';
  return z.iso.date().safeParse(date).success ? date : undefined;
}

function phone(raw?: string | null) {
  const digits = raw
    ?.trim()
    .replace(/^\+82[ -]?0?/, '0')
    .replace(/[ -]/g, '');
  return digits && /^01[016789]\d{7,8}$/.test(digits)
    ? digits.replace(/^(01.)(\d{3,4})(\d{4})$/, '$1-$2-$3')
    : undefined;
}

export function kakaoProfile(data: unknown): ProviderProfile {
  const { id, kakao_account: a } = z
    .object({
      id: z.number().int().positive().safe(),
      kakao_account: z
        .object({
          name: text,
          email: text,
          is_email_valid: z.boolean().optional(),
          is_email_verified: z.boolean().optional(),
          phone_number: text,
          birthyear: text,
          birthday: text,
          birthday_type: text,
        })
        .optional(),
    })
    .parse(data);
  const email = a?.email?.trim().toLowerCase();
  return {
    subject: String(id),
    name: a?.name ?? undefined,
    email,
    verifiedEmail: a?.is_email_verified && a.is_email_valid ? email : undefined,
    phone: phone(a?.phone_number),
    birthDate: a?.birthday_type === 'LUNAR' ? undefined : birthday(a?.birthyear, a?.birthday),
  };
}

export function naverProfile(data: unknown): ProviderProfile {
  const { response: a } = z
    .object({
      resultcode: z.literal('00'),
      response: z.object({
        id: z.string().min(1).max(255),
        name: text,
        email: text,
        mobile: text,
        birthyear: text,
        birthday: text,
      }),
    })
    .parse(data);
  return {
    subject: a.id,
    name: a.name ?? undefined,
    email: a.email?.trim().toLowerCase(),
    phone: phone(a.mobile),
    birthDate: birthday(a.birthyear, a.birthday),
  };
}
