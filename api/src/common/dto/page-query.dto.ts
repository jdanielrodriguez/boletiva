import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '../utils/pagination';

/** Query de paginación keyset: `?cursor=<id última fila>&limit=<n>`. */
export class PageQueryDto {
  @ApiPropertyOptional({ description: 'Cursor: id de la última fila de la página previa' })
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @ApiPropertyOptional({
    description: `Tamaño de página (1–${MAX_PAGE_LIMIT}, default ${DEFAULT_PAGE_LIMIT})`,
    minimum: 1,
    maximum: MAX_PAGE_LIMIT,
    default: DEFAULT_PAGE_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_LIMIT)
  limit?: number;
}
