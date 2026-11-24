import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { IsStrongPassword } from 'src/common/validators/password.validator';
import { normalizeEmail } from './login.dto';

export class SignupDto {
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(100)
  email: string;

  // IsStrongPassword also caps length at bcrypt's 72-byte limit.
  @IsString()
  @IsStrongPassword()
  password: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  fullName: string;
}
