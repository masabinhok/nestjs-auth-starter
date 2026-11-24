import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import {
  PaginationQueryDto,
  PageMetaDto,
} from '../common/dto/pagination.dto.js';
import { UserRole } from '../generated/prisma/enums.js';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @Length(2, 100)
  fullName?: string;
}

export class UpdateUserDto extends UpdateProfileDto {
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ListUsersQueryDto extends PaginationQueryDto {
  /** Matches email or name. */
  @IsOptional()
  @IsString()
  @Length(1, 100)
  search?: string;
}

export class AdminUserDto {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  emailVerified: boolean;
  isActive: boolean;
  mfaEnabled: boolean;
  lockedUntil: Date | null;
  createdAt: Date;
}

export class UserPageDto {
  data: AdminUserDto[];
  meta: PageMetaDto;
}
