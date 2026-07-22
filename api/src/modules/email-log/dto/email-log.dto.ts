import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PageQueryDto } from '../../../common/dto/page-query.dto';

/** Filtros del registro de correos (todo server-side + keyset). */
export class EmailLogQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: 'Busca por destinatario (contains, insensitive)' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  search?: string;

  @ApiPropertyOptional({ description: 'Filtra por tipo/plantilla (contains)' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  type?: string;

  @ApiPropertyOptional({ enum: ['queued', 'sent', 'failed'] })
  @IsOptional()
  @IsIn(['queued', 'sent', 'failed'])
  status?: string;

  @ApiPropertyOptional({ description: 'Desde (ISO YYYY-MM-DD)' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ description: 'Hasta inclusive (ISO YYYY-MM-DD)' })
  @IsOptional()
  @IsString()
  to?: string;
}

/** Fila del registro de correos (respuesta). */
export class EmailLogItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() recipient!: string;
  @ApiProperty() type!: string;
  @ApiProperty() subject!: string;
  @ApiProperty({ enum: ['queued', 'sent', 'failed'] }) status!: string;
  @ApiProperty({ type: String, nullable: true }) error!: string | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty({ type: String, nullable: true }) sentAt!: string | null;
}

export class EmailLogPageDto {
  @ApiProperty({ type: EmailLogItemDto, isArray: true }) items!: EmailLogItemDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}
