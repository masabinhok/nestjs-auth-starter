import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class LoginDto {
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(100)
  email: string;

  // The password policy is only enforced at signup, so changing it later
  // never locks existing users out.
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password: string;
}
