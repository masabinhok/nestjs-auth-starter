import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  IsObject,
  IsUUID,
} from 'class-validator';
import type { UserRole } from '../../generated/prisma/client.js';

const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/** NIST SP 800-63B: length matters, composition rules don't. */
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

export class SignupDto {
  /** @example jane@example.com */
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email: string;

  /** 8 to 128 characters. @example correct horse battery staple */
  @IsString()
  @MinLength(PASSWORD_MIN)
  @MaxLength(PASSWORD_MAX)
  password: string;

  /** @example Jane Doe */
  @IsString()
  @Length(2, 100)
  fullName: string;
}

export class LoginDto {
  /** @example admin@example.com */
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email: string;

  /** No policy here: changing the policy later must not lock anyone out. */
  @IsString()
  @MinLength(1)
  @MaxLength(PASSWORD_MAX)
  password: string;
}

export class SecondFactorDto {
  /** 6-digit code from the authenticator app. @example 123456 */
  @IsOptional()
  @Matches(/^\d{6}$/)
  code?: string;

  /** A one-time recovery code, instead of `code`. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  recoveryCode?: string;
}

/** Token clients send the second factor with the credentials. */
export class TokenRequestDto extends LoginDto {
  @IsOptional()
  @Matches(/^\d{6}$/)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  recoveryCode?: string;
}

export class RefreshTokenDto {
  @IsString()
  @MaxLength(512)
  refreshToken: string;
}

export class EmailDto {
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email: string;
}

export class TokenDto {
  /** The token from the emailed link (`?token=…`). */
  @IsString()
  @MaxLength(512)
  token: string;
}

export class ResetPasswordDto extends TokenDto {
  @IsString()
  @MinLength(PASSWORD_MIN)
  @MaxLength(PASSWORD_MAX)
  password: string;
}

export class ChangePasswordDto {
  @IsString()
  @MaxLength(PASSWORD_MAX)
  currentPassword: string;

  @IsString()
  @MinLength(PASSWORD_MIN)
  @MaxLength(PASSWORD_MAX)
  newPassword: string;
}

export class ConfirmMfaDto {
  @Matches(/^\d{6}$/)
  code: string;
}

export class MagicLinkRequestDto extends EmailDto {
  /** Relative path to land on after signing in. @example /dashboard */
  @IsOptional()
  @IsString()
  @Matches(/^\/(?!\/)/, { message: 'redirectTo must be a relative path' })
  @MaxLength(512)
  redirectTo?: string;
}

export class CreateApiKeyDto {
  /** @example CI deploy */
  @IsString()
  @Length(1, 100)
  name: string;

  /** Days until the key stops working. Omit for a key that never expires. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  expiresInDays?: number;
}

export class PasskeyVerifyDto {
  @IsUUID()
  challengeId: string;

  /** The browser's `PublicKeyCredential` as JSON (`@simplewebauthn/browser`). */
  @IsObject()
  response: Record<string, unknown>;
}

export class PasskeyRegisterVerifyDto extends PasskeyVerifyDto {
  /** @example MacBook Touch ID */
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;
}

// ------------------------------------------------------------ responses

export class UserDto {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  emailVerified: boolean;
}

export class SignInResponseDto {
  user: UserDto;
  /** True when the session still needs a TOTP or recovery code (`POST /auth/mfa/verify`). */
  mfaRequired: boolean;
}

export class TokenPairDto {
  accessToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  /** Opaque and single use: exchange it at `POST /auth/token/refresh`. */
  refreshToken: string;
  tokenType: 'Bearer';
}

export class MessageDto {
  message: string;
}

export class SessionDto {
  id: string;
  current: boolean;
  createdAt: Date;
  lastActiveAt: Date;
  expiresAt: Date;
  userAgent?: string;
  ip?: string;
  mfa?: string;
}

export class MfaEnrollmentDto {
  /** Base32 secret, for manual entry. */
  secret: string;
  /** `otpauth://` URI to render as a QR code. */
  uri: string;
}

export class RecoveryCodesDto {
  /** Shown once. Each works one time. */
  recoveryCodes: string[];
}

export class ApiKeyDto {
  id: string;
  name: string;
  createdAt: Date;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
}

export class CreatedApiKeyDto extends ApiKeyDto {
  /** The whole key. Shown once; only a hash is stored. */
  key: string;
}

export class PasskeyDto {
  id: string;
  name: string;
  deviceType: string;
  backedUp: boolean;
  createdAt: Date;
  lastUsedAt: Date | null;
}

export class PasskeyOptionsDto {
  challengeId: string;
  /** Pass to `startRegistration()` / `startAuthentication()` in the browser. */
  options: Record<string, unknown>;
}
