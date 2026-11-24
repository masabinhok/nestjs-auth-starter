import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}

export class PageMetaDto {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export function pageMeta(
  total: number,
  page: number,
  limit: number,
): PageMetaDto {
  return { total, page, limit, totalPages: Math.ceil(total / limit) };
}
